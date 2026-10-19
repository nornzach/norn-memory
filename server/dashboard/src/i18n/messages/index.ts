import type { Locale } from "../config";
import account from "./account";
import auth from "./auth";
import common from "./common";
import exact from "./exact";
import insights from "./insights";
import manage from "./manage";
import memories from "./memories";
import requests from "./requests";
import shell from "./shell";

// Each module pairs `en` with a `zh: typeof en`, so a missing or mistyped Chinese key fails the build.
const modules = [
  common,
  shell,
  auth,
  requests,
  memories,
  account,
  insights,
  manage,
  exact,
];

type Merge<T extends readonly { en: object }[]> = T extends readonly [
  infer Head extends { en: object },
  ...infer Tail extends readonly { en: object }[],
]
  ? Head["en"] & Merge<Tail>
  : unknown;

export type Messages = Merge<
  [
    typeof common,
    typeof shell,
    typeof auth,
    typeof requests,
    typeof memories,
    typeof account,
    typeof insights,
    typeof manage,
    typeof exact,
  ]
>;

const build = (locale: Locale) =>
  Object.assign({}, ...modules.map((m) => m[locale])) as Messages;

export const messages: Record<Locale, Messages> = {
  en: build("en"),
  zh: build("zh"),
};
