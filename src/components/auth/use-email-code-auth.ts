import { useAuth } from "@/hooks/use-auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type AuthStep = "email" | "code";
type Status = "idle" | "sending" | "verifying" | "guest";

/**
 * Pulsemap signs people in with a one-time code by email — the provider wired
 * into the Convex auth backend. This hook owns that flow: send a code, verify
 * it, resend it, or start a guest session, plus every piece of UI state the
 * panel needs.
 */
export function useEmailCodeAuth(redirectTo: string) {
  const { signIn, isLoading: authLoading, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<AuthStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const sentFor = useRef<string | null>(null);

  // Already signed in? Straight into the app.
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(redirectTo, { replace: true });
    }
  }, [authLoading, isAuthenticated, navigate, redirectTo]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const sending = status === "sending" || status === "verifying" || status === "guest";

  const sendCode = useCallback(
    async (address: string) => {
      await signIn("email-otp", { email: address });
      sentFor.current = address;
      setStep("code");
      setCooldown(45);
    },
    [signIn],
  );

  const submitEmail = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const address = email.trim().toLowerCase();

      if (!address) {
        setFieldError("Enter the email address on your account.");
        return;
      }
      if (!EMAIL_PATTERN.test(address)) {
        setFieldError("That does not look like an email address.");
        return;
      }

      setFieldError(null);
      setError(null);
      setStatus("sending");
      setEmail(address);
      try {
        await sendCode(address);
      } catch (sendError) {
        console.error("Code request failed:", sendError);
        setError("We could not send the code. Please try again in a moment.");
      } finally {
        setStatus("idle");
      }
    },
    [email, sendCode],
  );

  const submitCode = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (code.trim().length !== 6) {
        setFieldError("The code is six digits.");
        return;
      }
      setFieldError(null);
      setError(null);
      setStatus("verifying");
      try {
        await signIn("email-otp", { email, code: code.trim() });
        // The redirect effect above takes over from here.
      } catch (verifyError) {
        console.error("Code verification failed:", verifyError);
        setError("That code is not correct. Check the six digits and try again.");
        setCode("");
        setStatus("idle");
      }
    },
    [code, email, signIn],
  );

  const resendCode = useCallback(async () => {
    if (cooldown > 0 || sending) return;
    setError(null);
    setStatus("sending");
    try {
      await sendCode(email);
    } catch (resendError) {
      console.error("Resend failed:", resendError);
      setError("The code could not be resent. Please try again.");
    } finally {
      setStatus("idle");
    }
  }, [cooldown, email, sendCode, sending]);

  const useAnotherEmail = useCallback(() => {
    setStep("email");
    setCode("");
    setError(null);
    setFieldError(null);
    sentFor.current = null;
  }, []);

  const continueAsGuest = useCallback(async () => {
    setError(null);
    setStatus("guest");
    try {
      await signIn("anonymous");
    } catch (guestError) {
      console.error("Guest sign-in failed:", guestError);
      setError("Guest access is unavailable right now.");
      setStatus("idle");
    }
  }, [signIn]);

  return {
    step,
    email,
    setEmail,
    code,
    setCode,
    status,
    sending,
    error,
    fieldError,
    setFieldError,
    cooldown,
    submitEmail,
    submitCode,
    resendCode,
    useAnotherEmail,
    continueAsGuest,
  };
}
