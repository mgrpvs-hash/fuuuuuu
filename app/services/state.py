"""FSM states used by the bot."""

from aiogram.fsm.state import State, StatesGroup


class WalletState(StatesGroup):
    """Wallet connection flow state."""

    waiting_wallet = State()


class CreateAmountState(StatesGroup):
    """Room creation amount state."""

    waiting_amount = State()
