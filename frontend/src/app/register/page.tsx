'use client';

import { GoogleAuthButton } from '@/components/auth/GoogleAuthButton';
import { useAuth } from '@/contexts/AuthContext';
import {
  RegisterPayload,
  SessionAttendanceMode,
  SessionReferralSource,
} from '@/types';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const TEST_SESSION_OPTIONS = [
  { value: '10:00', label: '10:00 AM' },
];

const REFERRAL_OPTIONS: Array<{ value: SessionReferralSource; label: string }> = [
  { value: 'TELEGRAM', label: 'Telegram' },
  { value: 'INSTAGRAM', label: 'Instagram' },
  { value: 'FACEBOOK', label: 'Facebook' },
  { value: 'GOOGLE', label: 'Google' },
  { value: 'FRIENDS', label: 'Friends' },
  { value: 'OTHER', label: 'Other' },
];

const normalizeUzPhone = (value: string) => {
  const digits = value.replace(/\D/g, '');
  const withoutCountry = digits.startsWith('998') ? digits.slice(3) : digits;
  const local = withoutCountry.slice(0, 9);
  return `+998${local}`;
};

export default function RegisterPage() {
  const [error, setError] = useState('');
  const [isRegisterLoading, setIsRegisterLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [registration, setRegistration] = useState<
    Omit<RegisterPayload, 'scheduledAt'> & { testSession: string }
  >({
    firstName: '',
    lastName: '',
    username: '',
    password: '',
    attendanceMode: 'OFFLINE',
    testSession: '10:00',
    referralSource: 'TELEGRAM',
    phoneNumber: '+998',
  });
  const {
    register,
    registerWithGoogle,
    isAuthenticated,
    isLoading: authLoading,
  } = useAuth();
  const router = useRouter();
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      router.push('/dashboard');
    }
  }, [authLoading, isAuthenticated, router]);

  const getScheduledAtIso = (sessionTime: string) => {
    const [hoursRaw, minutesRaw] = sessionTime.split(':');
    const hours = Number.parseInt(hoursRaw || '', 10);
    const minutes = Number.parseInt(minutesRaw || '', 10);

    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
      throw new Error('Please select a valid test session time');
    }

    const now = new Date();
    const scheduled = new Date(now);
    scheduled.setHours(hours, minutes, 0, 0);

    if (scheduled <= now) {
      scheduled.setDate(scheduled.getDate() + 1);
    }

    return scheduled.toISOString();
  };

  const buildRegistrationPayload = (): RegisterPayload => {
    if (
      !registration.firstName.trim() ||
      !registration.lastName.trim() ||
      !registration.username.trim() ||
      !registration.password ||
      !registration.phoneNumber.trim()
    ) {
      throw new Error('Please fill all registration fields');
    }

    const normalizedPhone = normalizeUzPhone(registration.phoneNumber);
    if (!/^\+998\d{9}$/.test(normalizedPhone)) {
      throw new Error('Phone number must start with +998 and include 9 digits');
    }

    return {
      firstName: registration.firstName.trim(),
      lastName: registration.lastName.trim(),
      username: registration.username.trim(),
      password: registration.password,
      attendanceMode: registration.attendanceMode,
      scheduledAt: getScheduledAtIso(registration.testSession),
      referralSource: registration.referralSource,
      phoneNumber: normalizedPhone,
    };
  };

  const handleRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setIsRegisterLoading(true);

    try {
      const payload = buildRegistrationPayload();
      await register(payload);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setIsRegisterLoading(false);
    }
  };

  const handleGoogleRegister = async (idToken: string) => {
    setError('');
    setIsGoogleLoading(true);

    try {
      const payload = buildRegistrationPayload();
      await registerWithGoogle(idToken, payload);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google registration failed');
    } finally {
      setIsGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-linear-to-br from-black/5 to-transparent rounded-full blur-3xl" />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-linear-to-tl from-black/5 to-transparent rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-lg px-4">
        <div className="bg-white rounded-2xl border border-gray-200 p-8 shadow-xl shadow-gray-200/50">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center mb-8">
              <Image
                src="/logo.png"
                alt="Logo"
                width={156}
                height={156}
                style={{ width: 'auto', height: 'auto' }}
              />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Create Student Account</h1>
            <p className="text-gray-500 mt-2">Register to join your IELTS test session</p>
          </div>

          <form className="space-y-5" onSubmit={handleRegister}>
            {error && (
              <div className="p-3 rounded-lg bg-black text-white text-sm border border-black/10 text-center">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Name"
                value={registration.firstName}
                onChange={(e) =>
                  setRegistration((prev) => ({ ...prev, firstName: e.target.value }))
                }
                className="w-full px-4 py-3 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all"
                disabled={isGoogleLoading || isRegisterLoading}
                required
              />

              <input
                type="text"
                placeholder="Surname"
                value={registration.lastName}
                onChange={(e) =>
                  setRegistration((prev) => ({ ...prev, lastName: e.target.value }))
                }
                className="w-full px-4 py-3 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all"
                disabled={isGoogleLoading || isRegisterLoading}
                required
              />
            </div>

            <input
              type="text"
              placeholder="Username"
              value={registration.username}
              onChange={(e) =>
                setRegistration((prev) => ({ ...prev, username: e.target.value }))
              }
              className="w-full px-4 py-3 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all"
              disabled={isGoogleLoading || isRegisterLoading}
              required
            />

            <input
              type="password"
              placeholder="Password"
              value={registration.password}
              onChange={(e) =>
                setRegistration((prev) => ({ ...prev, password: e.target.value }))
              }
              className="w-full px-4 py-3 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all"
              disabled={isGoogleLoading || isRegisterLoading}
              required
            />

            <div className="grid grid-cols-2 gap-3">
              <select
                value={registration.attendanceMode}
                onChange={(e) =>
                  setRegistration((prev) => ({
                    ...prev,
                    attendanceMode: e.target.value as SessionAttendanceMode,
                  }))
                }
                className="w-full px-4 py-3 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all"
                disabled={isGoogleLoading || isRegisterLoading}
              >
                <option value="OFFLINE">Offline</option>
                <option value="ONLINE">Online</option>
              </select>

              <select
                value={registration.testSession}
                onChange={(e) =>
                  setRegistration((prev) => ({ ...prev, testSession: e.target.value }))
                }
                className="w-full px-4 py-3 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all"
                disabled={
                  isGoogleLoading ||
                  isRegisterLoading ||
                  registration.attendanceMode === 'ONLINE'
                }
              >
                {TEST_SESSION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                Where hear about us?
              </label>
              <select
                value={registration.referralSource}
                onChange={(e) =>
                  setRegistration((prev) => ({
                    ...prev,
                    referralSource: e.target.value as SessionReferralSource,
                  }))
                }
                className="w-full px-4 py-3 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all"
                disabled={isGoogleLoading || isRegisterLoading}
              >
                {REFERRAL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <input
              type="tel"
              placeholder="Phone Number"
              value={registration.phoneNumber}
              onChange={(e) =>
                setRegistration((prev) => ({
                  ...prev,
                  phoneNumber: normalizeUzPhone(e.target.value),
                }))
              }
              className="w-full px-4 py-3 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all"
              disabled={isGoogleLoading || isRegisterLoading}
              maxLength={13}
              required
            />

            <button
              type="submit"
              disabled={isGoogleLoading || isRegisterLoading}
              className="w-full py-3 rounded-lg bg-black text-white font-semibold hover:bg-gray-900 transition-all shadow-lg shadow-black/20 disabled:opacity-50"
            >
              {isRegisterLoading ? 'Registering...' : 'Register'}
            </button>

            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-white px-3 text-xs uppercase tracking-wide text-gray-400">Or</span>
              </div>
            </div>

            <GoogleAuthButton
              clientId={googleClientId}
              text="signup_with"
              disabled={isGoogleLoading || isRegisterLoading}
              onCredential={handleGoogleRegister}
            />

            <p className="text-xs text-gray-500 text-center">
              Use the same Google account later on the login page.
            </p>

            <p className="text-center text-sm text-gray-500">
              Already registered?{' '}
              <Link href="/login" className="font-semibold text-gray-900 hover:underline">
                Login
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
