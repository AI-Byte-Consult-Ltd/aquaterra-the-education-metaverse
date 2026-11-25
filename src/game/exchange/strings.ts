import type { Language } from "@/i18n/translations";
import type { ExchangeError, OrderStatus } from "./api";

const n = (v: number) => v.toLocaleString("en");

const en = {
  title: "Get Tide",
  intro: "Top up your wallet. Tide arrive as soon as the payment is confirmed; every purchase is in your history.",
  tabs: { card: "Card", crypto: "Crypto", market: "Market", token: "Cronos token" },
  bestValue: "Best value",
  save: (pct: number) => `Save ${pct}%`,
  // card
  cardNote: "Card, Apple Pay, Google Pay or Revolut Pay. Payment is handled by Revolut; we never see your card.",
  cardOff: "Card payments open very soon.",
  pay: (price: string) => `Pay ${price}`,
  redirecting: "Opening Revolut…",
  waitingPayment: "Waiting for the payment to be confirmed…",
  credited: (tide: number) => `${n(tide)} TIDE added to your wallet`,
  orderFailed: "The payment did not go through. No money was taken for this order.",
  // crypto
  cryptoNote: "Pay with USDT or CRO on the Cronos network. Each order has its own exact amount: send exactly that, in one transfer.",
  cryptoOff: "Crypto payments open very soon.",
  croOff: "CRO price is updating, try USDT or come back in a minute.",
  coin: "Coin",
  create: "Get payment details",
  sendExactly: "Send exactly",
  toAddress: "to this address on Cronos",
  network: "Network: Cronos (chain 25). Other networks will be lost.",
  until: (when: string) => `Waiting for your transfer until ${when}`,
  copy: "Copy",
  copied: "Copied",
  cancel: "Cancel",
  cryptoCredited: (tide: number) => `Payment received: ${n(tide)} TIDE added`,
  // market
  marketNote: (fee: string) =>
    `Residents sell Tide to each other for USDT on Cronos. The buyer pays the seller's wallet directly; Tide are held safely until the payment arrives. Market fee ${fee}% goes to the State Treasury.`,
  marketOff: "The Tide market is closed right now.",
  offers: "Offers",
  noOffers: "No offers yet. Be the first to sell.",
  per1000: (usdt: string) => `${usdt} USDT per 1,000`,
  seller: "Seller",
  buy: "Buy",
  howMany: "How many TIDE",
  youPay: (usdt: string) => `You pay about ${usdt} USDT`,
  payWithin: (min: number) => `Pay within ${min} minutes, or the Tide go back to the offer.`,
  paySeller: "Pay the seller exactly",
  youGet: (tide: number) => `You receive ${n(tide)} TIDE after the market fee`,
  dropTrade: "I changed my mind",
  sellTitle: "Sell Tide",
  sellAmount: "TIDE to sell",
  sellPrice: "Price, USDT per 1,000 TIDE",
  sellAddress: "Your Cronos wallet for USDT",
  sellFree: (free: number) => `You can sell up to ${n(free)} TIDE (welcome coins are for land).`,
  sell: "Put on sale",
  myOffer: "Your offer",
  withdrawOffer: "Withdraw",
  offerPosted: "Offer is on the market",
  offerBack: (tide: number) => `${n(tide)} TIDE back in your wallet`,
  tradeDone: (tide: number) => `Payment seen on chain: ${n(tide)} TIDE received`,
  sold: (tide: number, buyer: string) => `${buyer} paid for ${n(tide)} TIDE`,
  // token
  tokenNote: "Tide will be able to leave AquaTerra as the TIDE token on Cronos.",
  tokenOff: "Withdrawals to Cronos open after the legal review. Your Tide stay safe in the wallet meanwhile.",
  withdrawAmount: "TIDE to withdraw",
  withdrawAddress: "Cronos address",
  withdraw: "Withdraw",
  withdrawFee: (pct: string, min: number) => `Fee ${pct}% to the State Treasury. Smallest withdrawal ${n(min)} TIDE.`,
  withdrawQueued: "Withdrawal queued",
  // order list
  myOrders: "My purchases",
  statuses: { pending: "Waiting", credited: "Done", expired: "Expired", cancelled: "Cancelled", failed: "Failed" } satisfies Record<OrderStatus, string>,
  errors: {
    session: "Your session has ended. Please sign in again.",
    disabled: "This way of paying is not open yet.",
    pack: "Choose a pack.",
    coin: "Choose USDT or CRO.",
    limit: "Daily card limit reached. Try again tomorrow or pay with crypto.",
    too_many: "You already have open orders. Finish or cancel them first.",
    no_rate: "CRO price is updating. Try again in a minute.",
    busy: "Too many orders right now. Try again in a minute.",
    not_found: "Not found or already closed.",
    self: "That is your own offer.",
    amount: "Check the amount.",
    price: "Check the price.",
    address: "Enter a Cronos address: 0x and 40 characters.",
    insufficient: "Not enough Tide for this.",
    treasury_empty: "The Reserve cannot sell Tide right now.",
    provider: "Revolut did not answer. Please try again.",
    forbidden: "Only the founder can do this.",
    param: "Unknown setting.",
    action: "Unknown request.",
    network: "Connection problem. Check your internet and try again.",
  } satisfies Record<ExchangeError, string>,
  // admin
  admin: {
    title: "Tide sales",
    card: "Card (Revolut)",
    usdt: "USDT",
    cro: "CRO",
    market: "Market",
    escrow: "In market escrow",
    lastBlock: "Last Cronos block checked",
    deposit: "Project wallet on Cronos (receives USDT and CRO)",
    setDeposit: "Save address",
    unmatched: "Transfers that matched no order (check and grant by hand)",
    none: "None",
    orders: "Latest orders",
    params: "Rules",
    saveParam: "Save",
  },
};

export type ExchangeStrings = typeof en;

/** English only for now (decision 2026-11-22). Add a language by registering another object. */
const registry: Partial<Record<Language, ExchangeStrings>> = { en };

export const exchangeStrings = (lang: Language): ExchangeStrings => registry[lang] ?? en;
