import { AuthPanel } from "@/components/auth/AuthPanel";
import { AuthStage } from "@/components/auth/AuthStage";
import { useSearchParams } from "react-router";
import { resolveRedirectTarget } from "./Login";

export default function ForgotPassword() {
  const [searchParams] = useSearchParams();
  const redirectTo = resolveRedirectTarget(searchParams.get("returnTo"));

  return (
    <AuthStage
      headline={["Getting back in", "takes six", "digits."]}
      support="Pulsemap has never stored a password for you, so there is nothing to reset. Enter the email address on your account and a fresh sign-in code is on its way."
      navPrompt="Remembered your way?"
      navLabel="Sign in"
      navHref="/login"
    >
      <AuthPanel
        title="Find your way back in."
        subtitle="We will send a fresh sign-in code instead of a reset link."
        helper="Use the email address on your account — the code arrives in a few seconds."
        redirectTo={redirectTo}
        codeTitle="Check your email."
        switchPrompt="Still stuck?"
        switchLabel="Sign in instead"
        switchHref="/login"
        showGuest={false}
        underCard="Sign-in codes expire after fifteen minutes and can only be used once."
      />
    </AuthStage>
  );
}
