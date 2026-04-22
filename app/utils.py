from __future__ import annotations

from decimal import Decimal, InvalidOperation


def format_ton(amount: str) -> str:
    return f"{amount} TON"


def parse_amount(raw_text: str) -> str | None:
    try:
        amount_value = Decimal(raw_text.strip())
        if amount_value <= 0:
            return None
    except InvalidOperation:
        return None

    normalized = amount_value.normalize()
    if normalized == normalized.to_integral():
        return str(normalized.quantize(Decimal("1")))
    return format(normalized, "f")


def format_user(user_id: int, username: str | None) -> str:
    if username:
        return f"@{username} / {user_id}"
    return str(user_id)


def format_status(joined_count: int) -> str:
    return f"{joined_count}/2"


def format_counter(joined_count: int) -> str:
    return f"{joined_count} из 2"


def parse_user_id(raw_args: str | None) -> int | None:
    if not raw_args:
        return None
    first = raw_args.split()[0].strip()
    if not first.isdigit():
        return None
    return int(first)


def parse_room_identifier(raw_args: str | None) -> str | None:
    if not raw_args:
        return None
    identifier = raw_args.split()[0].strip()
    return identifier if identifier else None

