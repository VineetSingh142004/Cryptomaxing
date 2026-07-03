export type ReadinessStatus = "PASS" | "FAIL" | "PARTIAL" | "NOT_CONFIGURED" | "BLOCKED";

export interface ReadinessCheckItem {
  id: string;
  label: string;
  status: ReadinessStatus;
  note?: string;
}
