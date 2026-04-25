import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import App from "@/App";

export const Route = createFileRoute("/")({
  component: SpaIndex,
});

function SpaIndex() {
  return (
    <ClientOnly fallback={null}>
      <App />
    </ClientOnly>
  );
}
