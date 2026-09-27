import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  ArrowRight,
  Compass,
  Loader2,
  Lock,
  Mail,
} from "lucide-react";
import { Link } from "react-router";
import { useEmailCodeAuth } from "./use-email-code-auth";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function AuthPanel({
  title,
  subtitle,
  helper,
  redirectTo,
  codeTitle,
  switchPrompt,
  switchLabel,
  switchHref,
  showGuest = true,
  underCard,
}: {
  title: string;
  subtitle: string;
  helper: string;
  redirectTo: string;
  codeTitle: string;
  switchPrompt: string;
  switchLabel: string;
  switchHref: string;
  showGuest?: boolean;
  underCard?: string;
}) {
  const {
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
  } = useEmailCodeAuth(redirectTo);

  return (
    <div className="pm-in-card w-full" style={{ animationDelay: "80ms" }}>
      <div className="pm-glass mx-auto w-full max-w-[430px] px-6 py-7 sm:px-9 sm:py-9">
        <p className="mb-6 text-[11px] font-semibold tracking-[0.22em] text-white/45 uppercase lg:hidden">
          Your world is waiting
        </p>

        <header>
          <h2 className="font-display text-[2.1rem] leading-[1.02] text-white">
            {step === "email" ? title : codeTitle}
          </h2>
          <p className="mt-2.5 text-sm leading-6 text-white/65">
            {step === "email"
              ? subtitle
              : `We sent a six-digit code to ${email}. It stays valid for fifteen minutes.`}
          </p>
        </header>

        {error ? (
          <p
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-xl border border-white/15 bg-white/[0.07] px-3.5 py-2.5 text-[13px] leading-5 text-[#ffc9b8]"
          >
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : null}

        {step === "email" ? (
          <form
            onSubmit={submitEmail}
            className="pm-stagger mt-7 flex flex-col gap-5"
            noValidate
          >
            <div>
              <label
                htmlFor="auth-email"
                className="mb-2 block text-xs font-medium tracking-[0.1em] text-white/70 uppercase"
              >
                Email
              </label>
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-white/35"
                  aria-hidden="true"
                />
                <input
                  id="auth-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="pm-field pl-11"
                  value={email}
                  disabled={sending}
                  aria-invalid={fieldError ? true : undefined}
                  aria-describedby={fieldError ? "auth-email-error" : "auth-email-note"}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (fieldError) setFieldError(null);
                  }}
                  onBlur={(event) => {
                    const value = event.target.value.trim();
                    if (value.length > 0 && !EMAIL_PATTERN.test(value)) {
                      setFieldError("That does not look like an email address.");
                    }
                  }}
                />
              </div>
              {fieldError ? (
                <p id="auth-email-error" className="mt-2 text-xs text-[#ffc9b8]">
                  {fieldError}
                </p>
              ) : (
                <p id="auth-email-note" className="mt-2.5 text-xs leading-5 text-white/45">
                  {helper}
                </p>
              )}
            </div>

            <Link to="/forgot-password" className="pm-link self-end text-xs">
              Trouble signing in?
            </Link>

            <button
              type="submit"
              className="pm-cta"
              disabled={sending}
              aria-busy={sending}
            >
              {status === "sending" ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Sending code…
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight className="pm-arrow size-4" aria-hidden="true" />
                </>
              )}
            </button>

            {showGuest ? (
              <>
                <div className="flex items-center gap-3" aria-hidden="true">
                  <span className="h-px flex-1 bg-white/20" />
                  <span className="text-[11px] tracking-[0.18em] text-white/40 uppercase">
                    or
                  </span>
                  <span className="h-px flex-1 bg-white/20" />
                </div>

                <button
                  type="button"
                  className="pm-cta-glass"
                  onClick={continueAsGuest}
                  disabled={sending}
                  aria-busy={status === "guest"}
                >
                  {status === "guest" ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Compass className="size-4" aria-hidden="true" />
                  )}
                  Continue as a guest
                </button>
              </>
            ) : null}
          </form>
        ) : (
          <form
            onSubmit={submitCode}
            className="pm-stagger mt-7 flex flex-col gap-5"
            noValidate
          >
            <div>
              <label
                htmlFor="auth-code"
                className="mb-3 block text-xs font-medium tracking-[0.1em] text-white/70 uppercase"
              >
                Six-digit code
              </label>
              <InputOTP
                id="auth-code"
                autoFocus
                maxLength={6}
                value={code}
                disabled={sending}
                onChange={setCode}
                containerClassName="gap-2"
                aria-describedby={fieldError ? "auth-code-error" : undefined}
              >
                <InputOTPGroup className="gap-2">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <InputOTPSlot
                      key={index}
                      index={index}
                      className={cn(
                        "pm-otp-slot first:rounded-xl last:rounded-xl",
                        "data-[active=true]:border-white/45 data-[active=true]:ring-2 data-[active=true]:ring-white/15",
                      )}
                    />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              {fieldError ? (
                <p id="auth-code-error" className="mt-2 text-xs text-[#ffc9b8]">
                  {fieldError}
                </p>
              ) : (
                <p className="mt-3 flex items-center gap-2 text-xs leading-5 text-white/45">
                  <Lock className="size-3" aria-hidden="true" />
                  Paste or type the six digits — the code is not case sensitive.
                </p>
              )}
            </div>

            <button
              type="submit"
              className="pm-cta"
              disabled={sending || code.length !== 6}
              aria-busy={sending}
            >
              {sending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight className="pm-arrow size-4" aria-hidden="true" />
                </>
              )}
            </button>

            <div className="flex items-center justify-between gap-3 text-xs">
              <button
                type="button"
                className="pm-link disabled:cursor-not-allowed disabled:text-white/30"
                onClick={resendCode}
                disabled={cooldown > 0 || sending}
              >
                {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
              </button>
              <button type="button" className="pm-link" onClick={useAnotherEmail}>
                Use a different email
              </button>
            </div>
          </form>
        )}

        <div className="mt-7 border-t border-white/12 pt-5 text-sm text-white/60">
          {switchPrompt}{" "}
          <Link
            to={switchHref}
            className="pm-link font-medium text-white underline decoration-white/30 underline-offset-4"
          >
            {switchLabel}
          </Link>
        </div>
      </div>

      {underCard ? (
        <p className="mx-auto mt-4 max-w-[430px] px-2 text-center text-xs leading-5 text-white/45">
          {underCard}
        </p>
      ) : null}
    </div>
  );
}
