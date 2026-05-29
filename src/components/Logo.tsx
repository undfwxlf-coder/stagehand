interface LogoProps {
  size?: number;
  withWordmark?: boolean;
  className?: string;
}

export default function Logo({ size = 28, withWordmark = false, className = "" }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <rect x="1.5" y="1.5" width="29" height="29" rx="8" fill="#241A15" stroke="#3a2a22" strokeWidth="1" />
        <rect x="9" y="11" width="2.5" height="10" rx="1.25" fill="#F0EDDF" />
        <rect x="14.75" y="6.5" width="2.5" height="19" rx="1.25" fill="#BB0A21" />
        <rect x="20.5" y="13.5" width="2.5" height="5" rx="1.25" fill="#F0EDDF" />
      </svg>
      {withWordmark && (
        <span className="font-semibold tracking-tight text-white text-[1.05em] leading-none">
          Stagehand
        </span>
      )}
    </span>
  );
}
