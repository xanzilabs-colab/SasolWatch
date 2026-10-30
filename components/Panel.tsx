import type { ReactNode } from "react";

export function Panel({
  title,
  eyebrow,
  children,
  className = "",
  simulated = false,
  action,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  className?: string;
  simulated?: boolean;
  action?: ReactNode;
}) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-heading">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h2>{title}</h2>
        </div>
        <div className="panel-heading-actions">
          {simulated && <span className="simulated-tag">SIMULATED</span>}
          {action}
        </div>
      </header>
      {children}
    </section>
  );
}
