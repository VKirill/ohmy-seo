import type { FamilyId } from "@/lib/providers";

/**
 * Brand marks drawn inline so the sign-in buttons never wait on a network
 * request and never leak a referrer to the provider before the user clicks.
 */
export function ProviderMark({ family, size = 18 }: { family: FamilyId; size?: number }) {
  if (family === "google") {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
        <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
        <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z" />
        <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <rect width="48" height="48" rx="10" fill="#FC3F1D" />
      <path
        fill="#fff"
        d="M26.6 38h4.6V10h-6.7c-6.7 0-10.3 3.5-10.3 8.6 0 4.1 1.9 6.5 5.4 9L13.5 38h5l6.7-11-2.3-1.6c-2.8-1.9-4.2-3.4-4.2-6.6 0-2.8 1.9-4.7 5.6-4.7h2.3V38z"
      />
    </svg>
  );
}
