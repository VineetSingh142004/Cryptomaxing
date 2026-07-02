import { ApiSetupPanel } from "@/components/api-setup-panel";

export default function ApiSettingsPage() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl px-6 py-8">
        <ApiSetupPanel />
      </main>
    </div>
  );
}
