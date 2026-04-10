"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

type GoogleButtonText = "signin_with" | "signup_with" | "continue_with";

interface GoogleAuthButtonProps {
  clientId?: string;
  text: GoogleButtonText;
  disabled?: boolean;
  onCredential: (idToken: string) => Promise<void>;
}

interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleIdConfiguration {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  ux_mode?: "popup" | "redirect";
}

interface GoogleButtonConfiguration {
  type?: "standard" | "icon";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "large" | "medium" | "small";
  text?: GoogleButtonText;
  locale?: string;
  shape?: "rectangular" | "pill" | "circle" | "square";
  logo_alignment?: "left" | "center";
  width?: number;
}

interface GoogleAccountsId {
  initialize: (config: GoogleIdConfiguration) => void;
  renderButton: (
    parent: HTMLElement,
    options: GoogleButtonConfiguration,
  ) => void;
}

interface GoogleWindowNamespace {
  accounts: {
    id: GoogleAccountsId;
  };
}

const GOOGLE_GSI_SCRIPT_SRC = "https://accounts.google.com/gsi/client?hl=en";

declare global {
  interface Window {
    google?: GoogleWindowNamespace;
  }
}

export function GoogleAuthButton({
  clientId,
  text,
  disabled,
  onCredential,
}: GoogleAuthButtonProps) {
  const measureRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const onCredentialRef = useRef(onCredential);
  const renderedConfigKeyRef = useRef<string | null>(null);
  const [buttonWidth, setButtonWidth] = useState<number | null>(null);
  const [scriptReady, setScriptReady] = useState(
    typeof window !== "undefined" && Boolean(window.google),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onCredentialRef.current = onCredential;
  }, [onCredential]);

  const handleCredential = useCallback(
    (response: GoogleCredentialResponse) => {
      const token = response.credential;
      if (!token) {
        setError("Google sign-in did not return a valid credential.");
        return;
      }

      setError(null);

      void onCredentialRef.current(token).catch((credentialError) => {
        const message =
          credentialError instanceof Error
            ? credentialError.message
            : "Google authentication failed.";
        setError(message);
      });
    },
    [],
  );

  useEffect(() => {
    const buttonElement = measureRef.current;
    if (!buttonElement) {
      return;
    }

    const updateWidth = () => {
      const measuredWidth = Math.floor(buttonElement.getBoundingClientRect().width);
      if (measuredWidth > 0) {
        setButtonWidth(measuredWidth);
      }
    };

    updateWidth();

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => updateWidth())
        : null;

    observer?.observe(buttonElement);
    window.addEventListener("resize", updateWidth);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateWidth);
    };
  }, []);

  useEffect(() => {
    if (!scriptReady || !clientId || !window.google || !buttonRef.current) {
      renderedConfigKeyRef.current = null;
      return;
    }

    if (!buttonWidth || buttonWidth <= 0) {
      renderedConfigKeyRef.current = null;
      return;
    }

    const configKey = `${clientId}:${text}:${buttonWidth}`;
    if (renderedConfigKeyRef.current === configKey) {
      return;
    }

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: handleCredential,
      ux_mode: "popup",
    });

    buttonRef.current.innerHTML = "";
    window.google.accounts.id.renderButton(buttonRef.current, {
      type: "standard",
      theme: "outline",
      size: "large",
      text,
      locale: "en",
      shape: "pill",
      logo_alignment: "center",
      width: buttonWidth,
    });

    renderedConfigKeyRef.current = configKey;
  }, [buttonWidth, clientId, handleCredential, scriptReady, text]);

  if (!clientId) {
    return (
      <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
        Google auth is not configured. Add `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Script
        src={GOOGLE_GSI_SCRIPT_SRC}
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
        onError={() => setError("Failed to load Google sign-in script.")}
      />

      <div
        className={`flex min-h-[44px] items-center justify-center ${disabled ? "pointer-events-none opacity-60" : ""}`}
      >
        <div ref={measureRef} className="w-full">
          <div ref={buttonRef} className="flex w-full justify-center" />
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
