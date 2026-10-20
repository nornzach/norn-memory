import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { AUTH_ENDPOINTS } from "@/utils/api-endpoints";
import { getServerApiUrl } from "@/lib/server-api-url";

const COOKIE_NAME = "norn_m_refresh_token";

/** Signs out every other browser. The refresh token that identifies this one lives in an httpOnly cookie. */
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(COOKIE_NAME)?.value;
  const authorization = request.headers.get("authorization");

  if (!refreshToken || !authorization) {
    return NextResponse.json({ detail: "Not signed in." }, { status: 401 });
  }

  const res = await fetch(
    `${getServerApiUrl()}${AUTH_ENDPOINTS.SIGN_OUT_OTHERS}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    },
  );
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
