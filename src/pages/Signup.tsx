import { AuthPanel } from "@/components/auth/AuthPanel";
import { AuthStage } from "@/components/auth/AuthStage";
import { useSearchParams } from "react-router";
import { resolveRedirectTarget } from "./Login";

export default function Signup() {
  const [searchParams] = useSearchParams();
  const redirectTo = resolveRedirectTarget(searchParams.get("returnTo"));

  return (
    <AuthStage
      headline={["Every place", "worth keeping", "belongs on a map."]}
      support="Create an account and Pulsemap holds the notes, the coordinates and the reminders until you need them again — a year, or ten years, from now."
      navPrompt="Already have an account?"
      navLabel="Sign in"
      navHref="/login"
    >
      <AuthPanel
        title="Create your account."
        subtitle="Two steps, and no password anywhere."
        helper="We email a six-digit code to confirm it is you. The same code signs you in from then on."
        redirectTo={redirectTo}
        codeTitle="Confirm your email."
        switchPrompt="Already have an account?"
        switchLabel="Sign in"
        switchHref="/login"
        underCard="Free to start. Your first pin takes about twenty seconds."
      />
    </AuthStage>
  );
}
