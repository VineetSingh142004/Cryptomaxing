export type ReadinessStatus = "PASS" | "FAIL" | "PARTIAL";

export interface ReadinessCheckItem {
  id: string;
  label: string;
  status: ReadinessStatus;
  note?: string;
}
