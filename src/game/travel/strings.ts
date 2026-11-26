import type { Language } from "@/i18n/translations";
import type { TravelError } from "./api";
import type { HubKind, Mode } from "./network";

const tide = (n: number) => `${n.toLocaleString("en")} TIDE`;

const en = {
  you: "You",
  youAreIn: (district: string) => `You are in ${district}`,
  findMe: "Show where I am",
  modes: { walk: "Walk", car: "Car", train: "Train", ferry: "Ferry", plane: "Plane", boat: "Boat" } satisfies Record<Mode, string>,
  hubKinds: { station: "Railway station", port: "Harbour", airport: "Airport" } satisfies Record<HubKind, string>,
  travelTitle: "Travel",
  travelHere: (district: string) => `Travel to ${district}`,
  cheapest: "Cheapest",
  fastest: "Fastest",
  go: (fare: number) => (fare > 0 ? `Go for ${tide(fare)}` : "Go"),
  goShort: "Go",
  ownHubFare: (tax: number) => `yours: ${tide(tax)} tax`,
  going: "On the way…",
  arrived: (district: string, fare: number) => (fare > 0 ? `Arrived in ${district}. Fare ${tide(fare)}.` : `Arrived in ${district}.`),
  walkHere: "Walk here (free)",
  boatHere: (fare: number) => `Call a boat · ${tide(fare)}`,
  boatNote: "Water on the way: nobody walks on water. A boat takes you across; the fare goes to the state, with the travel tax.",
  boatRow: "Boat across the water",
  walked: "You are on the plot.",
  here: "You are here",
  unreachable: "There is no way to get there yet.",
  taxNote: (pct: number) => `${pct}% of every fare is the travel tax, paid to the State Treasury. The rest goes to the owner of the station, harbour or airport you leave from, or to the state while the state owns it. Roads and boats belong to the state.`,
  buyHereFirst: (district: string) => `Land is bought where you are. You are in ${district}: travel here first, then buy.`,
  seconds: (s: number) => `${Math.round(s)} s`,
  legs: (n: number) => (n === 1 ? "1 leg" : `${n} legs`),
  people: (n: number) => (n === 1 ? "1 resident is here now" : `${n.toLocaleString("en")} residents are here now`),
  // hub card
  owner: "Owner",
  stateOwned: "The Commonwealth",
  yours: "Yours",
  trips: "Trips from here",
  earned: "Earned by its owner",
  price: "Price",
  buyHub: (price: number) => `Buy for ${tide(price)}`,
  buying: "Buying…",
  bought: (name: string) => `${name} is yours. You earn the fares of every trip that starts here, less the travel tax.`,
  hubIncome: "The owner earns each fare from here, less the travel tax.",
  hubBuyNote: "Paid with earned TIDE (not welcome coins), to the State Treasury. You must be in this district.",
  travelToBuy: "Travel to this district to buy it.",
  departures: "Departures",
  noLeaving: "No lines from here yet.",
  errors: {
    session: "Your session has ended. Sign in again.",
    route: "That route does not exist.",
    boat: "There is water on the way. Call a boat.",
    not_here: "You need to be in this district.",
    insufficient: "Not enough TIDE.",
    taken: "It already has an owner.",
    not_found: "Not found.",
    hub_limit: "You own the most stations, harbours and airports one resident may hold.",
    forbidden: "Only the founder can do this.",
    param: "Unknown rule.",
    amount: "Enter a whole number.",
    action: "Not possible.",
    network: "Connection problem. Check your internet and try again.",
  } satisfies Record<TravelError, string>,
  // admin
  adminTitle: "Travel",
  adminIntro: "Fares and prices of transport. The travel tax is a law of the Commonwealth: it changes only by a vote.",
  adminTrips: (all: number, day: number) => `${all.toLocaleString("en")} trips, ${day.toLocaleString("en")} in the last 24 hours`,
  adminMoney: (fares: number, taxes: number) => `Fares ${tide(fares)}, of which travel tax ${tide(taxes)}`,
  paramLabels: {
    car_base: "Car: TIDE per trip",
    car_per100: "Car: TIDE per 100 tiles",
    train_base: "Train: TIDE per trip",
    train_per100: "Train: TIDE per 100 tiles",
    ferry_base: "Ferry: TIDE per trip",
    ferry_per100: "Ferry: TIDE per 100 tiles",
    boat_base: "Boat: TIDE per ride",
    boat_per100: "Boat: TIDE per 100 tiles",
    plane_base: "Plane: TIDE per flight",
    plane_per100: "Plane: TIDE per 100 tiles",
    price_station: "Price of a railway station",
    price_port: "Price of a harbour",
    price_airport: "Price of an airport",
    max_hubs_per_citizen: "Transport hubs one resident may own",
  } as Record<string, string>,
};

export type TravelStrings = typeof en;

/** English only for now (decision 2026-11-22). Add a language by registering another object. */
const registry: Partial<Record<Language, TravelStrings>> = { en };

export const travelStrings = (lang: Language): TravelStrings => registry[lang] ?? en;
