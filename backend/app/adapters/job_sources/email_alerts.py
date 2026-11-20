"""Job-alert emails → jobs.

LinkedIn, Naukri, Wellfound, Instahyre, Indeed, Foundit and Glassdoor do not allow automated access to their
sites, but they all email job alerts to you. This source reads those alert emails from your own mailbox
(IMAP, read-only — nothing is marked read, moved or deleted, and only messages from these platforms are
opened) and imports the job links they contain. The platforms' websites are never fetched; jobs are scored
on the title/company/snippet in the email, and you open the link to read the full posting and apply.
"""

from __future__ import annotations

import email
import imaplib
import re
from datetime import UTC, datetime, timedelta
from email.header import decode_header, make_header
from email.utils import parseaddr, parsedate_to_datetime
from urllib.parse import unquote

from bs4 import BeautifulSoup

from app.adapters.job_sources.base import (
    JobSourceAdapter,
    NormalizedJob,
    SearchCriteria,
    SourceCheck,
    SourceError,
)
from app.security.ssrf import UnsafeURLError, validate_url

PLATFORMS: dict[str, dict] = {
    "linkedin": {"domains": ("linkedin.com",), "link": re.compile(r"linkedin\.com/(?:comm/)?jobs/view/(\d+)")},
    "naukri": {"domains": ("naukri.com",), "link": re.compile(r"naukri\.com/(?:jd/)?job-listings-[^?\s\"']*?-(\d{6,})")},
    "wellfound": {"domains": ("wellfound.com", "angel.co"),
                  "link": re.compile(r"(?:wellfound\.com|angel\.co)/(?:company/[^/\s]+/)?jobs/(\d+)")},
    "instahyre": {"domains": ("instahyre.com",), "link": re.compile(r"instahyre\.com/job-(\d+)")},
    "indeed": {"domains": ("indeed.com", "indeed.co.in"), "link": re.compile(r"indeed\.[a-z.]+/(?:rc/clk|viewjob|pagead/clk)\?[^\s\"']*?jk=([0-9a-f]{8,})")},
    "foundit": {"domains": ("foundit.in", "monsterindia.com"), "link": re.compile(r"foundit\.in/job/[^\s\"'?]*?-(\d{5,})")},
    "glassdoor": {"domains": ("glassdoor.com", "glassdoor.co.in"), "link": re.compile(r"glassdoor\.[a-z.]+/[^\s\"']*?jobListingId=(\d+)")},
}
_JUNK_TEXT = re.compile(r"(?i)^(view|apply|see|save|unsubscribe|manage|more|jobs?|easy apply|show|search|settings|here|"
                        r"\d+ (new )?jobs?|view (all|job|jobs)|see all jobs)\b")


IMAP_HOSTS = {
    "gmail.com": "imap.gmail.com", "googlemail.com": "imap.gmail.com",
    "outlook.com": "outlook.office365.com", "hotmail.com": "outlook.office365.com", "live.com": "outlook.office365.com",
    "msn.com": "outlook.office365.com",
    "yahoo.com": "imap.mail.yahoo.com", "yahoo.co.in": "imap.mail.yahoo.com", "ymail.com": "imap.mail.yahoo.com",
    "icloud.com": "imap.mail.me.com", "me.com": "imap.mail.me.com", "mac.com": "imap.mail.me.com",
    "zoho.com": "imap.zoho.com", "zohomail.in": "imap.zoho.in", "rediffmail.com": "imap.rediffmail.com",
    "aol.com": "imap.aol.com", "proton.me": "", "protonmail.com": "",
}


def imap_host_for(address: str) -> str:
    """IMAP server for well-known providers; '' when unknown (the user enters it)."""
    domain = address.rsplit("@", 1)[-1].strip().lower() if "@" in address else ""
    return IMAP_HOSTS.get(domain, "")


def platform_for_sender(sender: str) -> str | None:
    addr = parseaddr(sender)[1].lower()
    domain = addr.split("@")[-1]
    for name, cfg in PLATFORMS.items():
        if any(domain == d or domain.endswith("." + d) for d in cfg["domains"]):
            return name
    return None


def _clean(text: str) -> str:
    text = text or ""
    if re.search(r"%[0-9A-Fa-f]{2}", text):  # some mailers leave names URL-encoded ("Acme%20Labs")
        text = unquote(text)
    return re.sub(r"\s+", " ", text).strip()


_RATING = re.compile(r"^\d(\.\d)?$")
_WORKPLACE = re.compile(r"\s*\((on-site|onsite|hybrid|remote)\)", re.I)


def _card_lines(tag) -> list[str]:  # noqa: ANN001
    lines = [_clean(x) for x in tag.get_text("\n").split("\n")]
    # drop junk, company ratings ("3.7") and logo placeholder letters ("Q")
    return [x for x in lines if len(x) > 2 and not _JUNK_TEXT.match(x) and not _RATING.match(x) and len(x) < 140]


def parse_alert_email(platform: str, html: str, received: datetime | None) -> list[NormalizedJob]:
    """Extract (title, company, location, link) entries from one alert email."""
    pattern = PLATFORMS[platform]["link"]
    soup = BeautifulSoup(html, "html.parser")
    jobs: dict[str, NormalizedJob] = {}
    for a in soup.find_all("a", href=True):
        m = pattern.search(a["href"])
        if not m:
            continue
        job_id = m.group(1)
        # Some mailers (e.g. Naukri) wrap the whole job card in the link: title, company, rating, location.
        own_lines = _card_lines(a)
        if len(own_lines) >= 2:
            lines, title = own_lines, own_lines[0]
        else:
            title = _clean(a.get_text(" "))
            # The surrounding block usually holds title, company and location lines.
            block = a.find_parent(["td", "tr", "table", "div", "li"]) or a
            lines = _card_lines(block)
            if not title or _JUNK_TEXT.match(title) or len(title) < 4:
                title = lines[0] if lines else ""
        if not title:
            continue
        rest = [x for x in lines if x != title]
        company = rest[0] if rest else ""
        location = rest[1] if len(rest) > 1 else ""
        workplace = "remote" if re.search(r"(?i)remote", " ".join(rest)) else "unknown"
        # LinkedIn puts company and place on one line: "Acme · Noida (On-site)". The next line is a perk
        # ("Actively recruiting", a salary), not the location.
        if " · " in company:
            company, location = (x.strip() for x in company.split(" · ", 1))
            wp = _WORKPLACE.search(location)
            if wp:
                workplace = {"on-site": "onsite", "onsite": "onsite"}.get(wp.group(1).lower(), wp.group(1).lower())
                location = _WORKPLACE.sub("", location).strip()
        existing = jobs.get(job_id)
        if existing is not None and existing.company:
            continue
        url = a["href"].split("?")[0] if platform in ("linkedin", "naukri", "instahyre", "foundit") else a["href"]
        if platform == "linkedin":
            url = f"https://www.linkedin.com/jobs/view/{job_id}/"
        snippet = " · ".join(x for x in rest[:4] if x)
        jobs[job_id] = NormalizedJob(
            source_kind="email_alerts", external_id=f"{platform}:{job_id}", company=company[:300] or platform.title(),
            title=title[:300], location=location[:300],
            workplace_type=workplace,
            description_text=(f"{title}\n{snippet}\n\nImported from a {platform.title()} job-alert email. "
                              "Open the posting for the full description; paste it into this job to improve the match."),
            posted_at=received, application_url=url, posting_url=url,
        )
    return list(jobs.values())


def _decode(value: str | None) -> str:
    try:
        return str(make_header(decode_header(value or "")))
    except Exception:  # noqa: BLE001
        return value or ""


class EmailAlertsAdapter(JobSourceAdapter):
    kind = "email_alerts"
    label = "Job-alert emails (LinkedIn, Naukri, Wellfound, Instahyre, Indeed, Foundit, Glassdoor)"
    description = ("Reads job-alert emails from your mailbox (read-only) and imports the jobs. Turn on job alerts on "
                   "LinkedIn/Naukri/etc. with the same email, then paste an app password. Gmail: 2-Step Verification "
                   "must be on; create the app password at myaccount.google.com/apppasswords.")
    help_url = "https://myaccount.google.com/apppasswords"
    identifier_help = "Mailbox/folder to read, usually INBOX"
    identifier_default = "INBOX"
    credential_fields = [
        {"key": "password", "label": "App password (16 letters from Google)", "secret": True},
        {"key": "username", "label": "Email address", "secret": False, "optional": True,
         "placeholder": "Your account email"},
        {"key": "imap_host", "label": "IMAP server", "secret": False, "optional": True,
         "placeholder": "Detected from the email address"},
    ]
    complete_listing = False
    min_interval_minutes = 15
    lookback_days = 3

    def _connect(self) -> imaplib.IMAP4_SSL:
        user = (self.credentials.get("username") or "").strip()
        host = (self.credentials.get("imap_host") or "").strip().lower() or imap_host_for(user)
        pwd = (self.credentials.get("password") or "").replace(" ", "")  # Google shows it as "abcd efgh ijkl mnop"
        if not user or not pwd:
            raise SourceError("Enter the app password.")
        if not host:
            raise SourceError("Could not detect the IMAP server for this email; enter it under More options.")
        if not re.fullmatch(r"[a-z0-9.-]+", host):
            raise SourceError("Invalid IMAP server name.")
        try:
            validate_url(f"https://{host}/")  # public hosts only (SSRF guard)
        except UnsafeURLError as exc:
            raise SourceError(f"IMAP server not allowed: {exc}") from exc
        try:
            conn = imaplib.IMAP4_SSL(host, 993, timeout=20)
            conn.login(user, pwd)
            return conn
        except imaplib.IMAP4.error as exc:
            raise SourceError("Email login failed. For Gmail use an App Password, not your normal password.") from exc
        except (TimeoutError, OSError) as exc:
            raise SourceError(f"Could not connect to {host}: {type(exc).__name__}") from exc

    def validate_source_access(self, identifier: str) -> SourceCheck:
        try:
            conn = self._connect()
        except SourceError as exc:
            return SourceCheck(False, str(exc))
        try:
            status, _ = conn.select(_mailbox(identifier), readonly=True)
            if status != "OK":
                return SourceCheck(False, f"Mailbox '{identifier or 'INBOX'}' not found.")
        finally:
            _logout(conn)
        return SourceCheck(True, "Mailbox connected (read-only).",
                           display_name=f"Job alerts ({self.credentials.get('username', '')})")

    def discover_jobs(self, identifier: str, criteria: SearchCriteria) -> list[NormalizedJob]:
        conn = self._connect()
        out: list[NormalizedJob] = []
        try:
            status, _ = conn.select(_mailbox(identifier), readonly=True)
            if status != "OK":
                raise SourceError(f"Mailbox '{identifier or 'INBOX'}' not found.")
            since = (datetime.now(UTC) - timedelta(days=self.lookback_days)).strftime("%d-%b-%Y")
            ids: set[bytes] = set()
            for cfg in PLATFORMS.values():
                for domain in cfg["domains"]:
                    status, data = conn.search(None, "SINCE", since, "FROM", domain)
                    if status == "OK" and data and data[0]:
                        ids.update(data[0].split())
            for msg_id in sorted(ids)[-300:]:
                # BODY.PEEK keeps messages unread.
                status, parts = conn.fetch(msg_id, "(BODY.PEEK[])")
                if status != "OK" or not parts or not isinstance(parts[0], tuple):
                    continue
                msg = email.message_from_bytes(parts[0][1])
                platform = platform_for_sender(_decode(msg.get("From")))
                if platform is None:
                    continue
                try:
                    received = parsedate_to_datetime(msg.get("Date"))
                except (TypeError, ValueError):
                    received = None
                html = _html_body(msg)
                if html:
                    out.extend(parse_alert_email(platform, html, received))
        finally:
            _logout(conn)
        return out

    def fetch_job_details(self, identifier: str, external_id: str) -> NormalizedJob | None:
        return None

    def normalize_job(self, raw: dict, identifier: str) -> NormalizedJob:
        raise NotImplementedError

    def check_job_status(self, identifier: str, external_id: str) -> str:
        return "unknown"


def _mailbox(identifier: str) -> str:
    box = (identifier or "INBOX").strip() or "INBOX"
    if not re.fullmatch(r"[\w ./\[\]-]{1,100}", box):
        raise SourceError("Invalid mailbox name.")
    return f'"{box}"' if " " in box else box


def _html_body(msg: email.message.Message) -> str:
    for part in msg.walk() if msg.is_multipart() else [msg]:
        if part.get_content_type() == "text/html":
            payload = part.get_payload(decode=True) or b""
            return payload.decode(part.get_content_charset() or "utf-8", errors="replace")
    for part in msg.walk() if msg.is_multipart() else [msg]:
        if part.get_content_type() == "text/plain":
            payload = part.get_payload(decode=True) or b""
            text = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
            return "".join(f'<p><a href="{u}">{u}</a></p>' for u in re.findall(r"https?://\S+", text))
    return ""


def _logout(conn: imaplib.IMAP4_SSL) -> None:
    try:
        conn.logout()
    except Exception:  # noqa: BLE001
        conn.shutdown()



# ----------------------------------------------------------------- account-verification emails (careers portals)

_VERIFY = re.compile(r"(?i)verif|confirm|activat|validat")
_CODE = re.compile(r"(?i)(?:code|otp|pin)[^0-9]{0,40}\b(\d{4,8})\b|\b(\d{6})\b[^.]{0,40}(?:code|otp)")


def base_domain(host: str) -> str:
    parts = host.lower().strip(".").split(".")
    if len(parts) >= 3 and len(parts[-1]) == 2 and parts[-2] in {"co", "com", "org", "net", "gov", "ac"}:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


# Platforms that host many employers on one domain: there, only the employer's own host counts.
SHARED_PLATFORMS = {"myworkdayjobs.com", "myworkday.com", "workday.com", "successfactors.com", "successfactors.eu",
                    "taleo.net", "icims.com", "oraclecloud.com", "darwinbox.in", "darwinbox.com", "zohorecruit.com",
                    "zohorecruit.in", "keka.com", "freshteam.com", "smartrecruiters.com", "greenhouse.io", "lever.co",
                    "ashbyhq.com", "workable.com", "jobvite.com", "brassring.com", "avature.net", "eightfold.ai"}


def verification_match_key(host: str) -> str:
    base = base_domain(host)
    return host.lower() if base in SHARED_PLATFORMS else base


def find_verification(adapter: EmailAlertsAdapter, host: str, since: datetime) -> dict:
    """Newest email (after ``since``) with an account-verification link for ``host``, or a one-time code.
    Read-only: messages stay unread."""
    want = verification_match_key(host)
    conn = adapter._connect()
    try:
        status, _ = conn.select("INBOX", readonly=True)
        if status != "OK":
            return {}
        status, data = conn.search(None, "SINCE", since.strftime("%d-%b-%Y"))
        ids = data[0].split() if status == "OK" and data and data[0] else []
        for msg_id in reversed(ids[-40:]):
            status, parts = conn.fetch(msg_id, "(BODY.PEEK[])")
            if status != "OK" or not parts or not isinstance(parts[0], tuple):
                continue
            msg = email.message_from_bytes(parts[0][1])
            try:
                received = parsedate_to_datetime(msg.get("Date"))
            except (TypeError, ValueError):
                received = None
            if received is None or received < since:
                continue
            sender = parseaddr(_decode(msg.get("From")))[1].lower()
            subject = _decode(msg.get("Subject"))
            html = _html_body(msg)
            related = want in sender or want in html.lower()
            soup = BeautifulSoup(html, "html.parser")
            for a in soup.find_all("a", href=True):
                href = a["href"].strip()
                if not href.startswith("https://"):
                    continue
                link_host = href.split("/")[2].lower()
                if (want in link_host and (_VERIFY.search(href) or _VERIFY.search(a.get_text(" ")))) or (
                        related and _VERIFY.search(a.get_text(" ") + " " + subject) and _VERIFY.search(href + a.get_text(" "))):
                    return {"url": href, "subject": subject[:200]}
            if related and _VERIFY.search(subject):
                m = _CODE.search(soup.get_text(" "))
                if m:
                    return {"code": m.group(1) or m.group(2), "subject": subject[:200]}
        return {}
    finally:
        _logout(conn)
