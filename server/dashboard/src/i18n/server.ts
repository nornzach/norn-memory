import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, Locale, resolveLocale } from "./config";
import { messages } from "./messages";

/** Locale for server layouts: the saved cookie, else Accept-Language. */
export async function getServerLocale(): Promise<Locale> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  return resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value,
    headerList.get("accept-language"),
  );
}

export async function getServerMessages() {
  return messages[await getServerLocale()];
}
