import axios, { AxiosError } from "axios";
import { getOrCreateBrowserKey } from "./browserKey";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "https://linkvault-backend-only.onrender.com",
});

api.defaults.headers.common["X-Auth-Fingerprint"] = getOrCreateBrowserKey();

export function setApiToken(token: string | null) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
}

type ApiErrorShape = {
  message?: string;
};

export function getApiErrorMessage(error: unknown, fallback = "Request failed") {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<ApiErrorShape>;
    const serverMessage = axiosError.response?.data?.message;
    if (serverMessage) {
      return serverMessage;
    }
    if (axiosError.message) {
      return axiosError.message;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}
