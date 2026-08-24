export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type Session = {
  token: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    permissions: string[];
  };
};

export async function api<T>(
  path: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  const isForm = options.body instanceof FormData;
  const response = await fetch(`${API_URL}/api${path}`, {
    ...options,
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const details =
      Array.isArray(body.fields) && body.fields.length
        ? body.fields.join(" ")
        : Array.isArray(body.issues) && body.issues.length
          ? body.issues.map((issue: { message: string; path?: string[] }) => {
              const field = issue.path?.join(".");
              return field ? `${field}: ${issue.message}` : issue.message;
            }).join(" ")
          : "";
    throw new Error([body.message, details].filter(Boolean).join(" ") || "No se pudo completar la accion.");
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export const money = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0
});
