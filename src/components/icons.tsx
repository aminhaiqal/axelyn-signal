import type { SVGProps } from "react";

export function SignalMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props}>
      <path d="M3 16h5l3-9 5 18 4-13 3 8h6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowUpRight(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path d="M5 15 15 5m0 0H7m8 0v8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Chevron(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Plus(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path d="M4.5 6.5h11M8 3.75h4M6 6.5l.65 9h6.7l.65-9M8.25 9v4.25M11.75 9v4.25" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SettingsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path d="M4 5h8m3 0h1M4 10h2m3 0h7M4 15h7m3 0h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="13.5" cy="5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="7.5" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12.5" cy="15" r="1.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function EyeIcon({ crossed = false, ...props }: SVGProps<SVGSVGElement> & { crossed?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path d="M2.5 10s2.7-4.5 7.5-4.5 7.5 4.5 7.5 4.5-2.7 4.5-7.5 4.5S2.5 10 2.5 10Z" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="10" cy="10" r="2" stroke="currentColor" strokeWidth="1.4" />
      {crossed && <path d="M4 4l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />}
    </svg>
  );
}
