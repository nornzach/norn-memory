import axios, { AxiosError, AxiosInstance } from "axios";

let cachedToken: string | null = null;
const LOGIN_PATH = "/login";

export const setAccessToken = (token: string | null) => {
  cachedToken = token;
};

export const getAccessToken = (): string | null => {
  return cachedToken;
};

const handleTokenError = () => {
  cachedToken = null;
};

const redirectToLogin = () => {
  if (typeof window !== "undefined") {
    window.location.href = LOGIN_PATH;
  }
};

let refreshing: Promise<string | null> | null = null;

/**
 * Exchanges the refresh cookie for a new access token. Refresh tokens are single-use, so
 * concurrent callers share one request: a second exchange of the same token would fail and
 * clear the cookie, signing the user out.
 */
export const refreshAccessToken = (): Promise<string | null> => {
  refreshing ??= (async () => {
    const refreshResponse = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
    });

    if (!refreshResponse.ok) {
      return null;
    }

    const data = await refreshResponse.json();
    setAccessToken(data.access_token);
    return data.access_token as string;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
};

const createApi = (): AxiosInstance & {
  postStream: (url: string, data: unknown) => Promise<Response>;
} => {
  const api = axios.create({
    baseURL: process.env.NEXT_PUBLIC_API_URL,
  });

  api.interceptors.request.use(
    async (config) => {
      if (cachedToken) {
        config.headers = config.headers ?? {};
        config.headers.Authorization = `Bearer ${cachedToken}`;
      }
      return config;
    },
    (error) => {
      return Promise.reject(error);
    },
  );

  api.interceptors.response.use(
    (response) => response,
    async (error: AxiosError<{ error?: string }>) => {
      if (error.response?.status === 401) {
        handleTokenError();

        try {
          const nextToken = await refreshAccessToken();
          if (nextToken && error.config) {
            error.config.headers = error.config.headers ?? {};
            error.config.headers.Authorization = `Bearer ${nextToken}`;
            return api.request(error.config);
          }
        } catch {}

        handleTokenError();
        redirectToLogin();
      }

      if (error.response?.data?.error) {
        return Promise.reject(error.response.data.error);
      }

      return Promise.reject(error);
    },
  );

  const postStream = async (url: string, data: unknown): Promise<Response> => {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${url}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: cachedToken ? `Bearer ${cachedToken}` : "",
      },
      body: JSON.stringify(data),
    });

    if (response.status === 401) {
      handleTokenError();
      redirectToLogin();
      throw new Error("Unauthorized");
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Request failed");
    }

    return response;
  };

  return Object.assign(api, { postStream });
};

export const api = createApi();
