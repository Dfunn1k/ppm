"""Puerto de correo. Hoy el adaptador es SMTP; en desarrollo apunta a Mailpit
(http://localhost:8025), que atrapa los correos en vez de enviarlos."""

import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Protocol

from app.config import get_settings


@dataclass(frozen=True)
class Mail:
    to: str
    subject: str
    body: str


class Mailer(Protocol):
    def send(self, mail: Mail) -> None: ...


class SmtpMailer:
    def send(self, mail: Mail) -> None:
        s = get_settings()
        msg = EmailMessage()
        msg["From"] = s.mail_from
        msg["To"] = mail.to
        msg["Subject"] = mail.subject
        msg.set_content(mail.body)
        with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=10) as smtp:
            if s.smtp_starttls:
                smtp.starttls()
            if s.smtp_user:
                smtp.login(s.smtp_user, s.smtp_password or "")
            smtp.send_message(msg)


def get_mailer() -> Mailer:
    return SmtpMailer()
