"use client";

import { useState } from "react";
import { ChevronDown, MessageCircle, MessageSquareText } from "lucide-react";
import { Panel } from "./Panel";
import type { AlertRow } from "@/lib/types";

function formattedTime(value: string) {
  return new Intl.DateTimeFormat("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" }).format(new Date(value));
}

export function AlertsFeed({ alerts, simulated }: { alerts: AlertRow[]; simulated: boolean }) {
  const [expanded, setExpanded] = useState<string | number | null>(null);
  return (
    <Panel title="WhatsApp early warnings" eyebrow="ALERT FEED" simulated={simulated}>
      {alerts.length === 0 ? <div className="empty-state"><MessageCircle size={16} /> No alerts have been generated yet.</div> : (
        <div className="alert-list">
          {alerts.map((alert) => (
            <article className="alert-item" key={alert.id}>
              <button className="alert-summary" onClick={() => setExpanded(expanded === alert.id ? null : alert.id)}>
                <span className="alert-type-icon"><MessageSquareText size={15} /></span>
                <span className="alert-recipient">
                  <strong>{alert.recipient_name === "(no opted-in subscribers)" ? "No opted-in subscribers" : alert.recipient_name ?? "WhatsApp recipient"}</strong>
                  <small>{alert.channel === "whatsapp" ? "WhatsApp" : alert.channel} · {alert.status === "dry_run" ? "preview · not sent" : alert.status} · {formattedTime(alert.created_at)}</small>
                </span>
                <span className={`alert-status alert-${alert.status}`}>{alert.status === "sent" ? "SENT" : alert.status === "failed" ? "FAILED" : alert.status === "pending" ? "PENDING" : "PREVIEW"}</span>
                <ChevronDown size={14} className={expanded === alert.id ? "chevron-open" : ""} />
              </button>
              {expanded === alert.id && <p className="alert-message">{alert.message ?? "No message preview available."}{alert.status === "dry_run" && <><br /><strong>Preview only; this message was not delivered.</strong></>}</p>}
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}
