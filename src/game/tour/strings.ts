import type { Language } from "@/i18n/translations";

const en = {
  label: "Tour",
  stepOf: (i: number, n: number) => `${i} of ${n}`,
  next: "Next",
  back: "Back",
  skip: "Skip tour",
  done: "Start exploring",
  close: "Close tour",
  steps: {
    drop: {
      title: "This glowing drop is you",
      body: "You stand in your home district. Wherever you go, the drop goes with you. Tap the chip at the bottom left any time to find yourself.",
      action: "Show me",
    },
    plot: {
      title: "Every piece of land is a plot",
      body: "Land and water are split into plots, each with its own address. Tap any plot to see its size, climate, view and price. Search an address at the top.",
    },
    buy: {
      title: "Buy land for Tide",
      body: (balance: string | null) =>
        `${balance ? `You hold ${balance} TIDE. ` : ""}You can buy a free plot in the district where you stand: tap it, then Buy. Your land earns Tide every day; collect it in your wallet.`,
      action: "Open wallet",
    },
    build: {
      title: "Build on your plot",
      body: "Tap a plot you own and press Open plot. Start with a foundation, then grow to 10, 30 and 60 floors. A permit fee goes to the treasury; taller buildings earn more.",
    },
    travel: {
      title: "Travel the world",
      body: "To buy land elsewhere, travel there. Tap a station, harbour or airport and pick a car, train, ferry or plane. Fares are paid in Tide, and a travel tax goes to the treasury.",
    },
  },
};

export type TourStrings = typeof en;

/** English only for now; other languages fall back to English. */
const registry: Partial<Record<Language, TourStrings>> = { en };

export const tourStrings = (lang: Language): TourStrings => registry[lang] ?? en;
