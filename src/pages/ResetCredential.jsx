import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  resetPasswordApi,
  resetPinApi,
} from '../services/authApi';
import { showToast } from '../utils/toastHelper';
import logo from '../assets/logo.png';
import {
  getPasswordChecks,
  isValidPassword,
  PASSWORD_REQUIREMENTS,
} from '../utils/passwordPolicy';

const PIN_LENGTH = 6;

const EyeIcon = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.25 12s3.75-7.5 9.75-7.5 9.75 7.5 9.75 7.5-3.75 7.5-9.75 7.5S2.25 12 2.25 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOffIcon = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 3l18 18" />
    <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
    <path d="M6.2 6.2C3.8 8 2.25 12 2.25 12s3.75 7.5 9.75 7.5c2.1 0 3.9-.5 5.4-1.3" />
    <path d="M14.1 4.8c4.5.9 7.65 5.7 7.65 7.2 0 0-1.05 2.1-3 3.95" />
  </svg>
);

const getValidatedPinInput = (rawValue) => {
  if (!rawValue) {
    return '';
  }

  if (/[^0-9]/.test(rawValue)) {
    return null;
  }

  return rawValue.slice(0, PIN_LENGTH);
};

const ResetCredential = ({ mode }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [value, setValue] = useState('');
  const [confirmValue, setConfirmValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const isPinMode = mode === 'pin';
  const passwordChecks = getPasswordChecks(value);
  const isPasswordValid = isValidPassword(value);
  const passwordsDoNotMatch = !isPinMode && Boolean(confirmValue) && value !== confirmValue;
  const canSubmit = isPinMode
    ? Boolean(token)
    : Boolean(token && isPasswordValid && confirmValue && !passwordsDoNotMatch);

  const labels = useMemo(() => {
    if (isPinMode) {
      return {
        title: 'Reset PIN',
        subtitle: 'Enter a new 6-digit PIN for your account.',
        field: 'New PIN',
        confirm: 'Confirm PIN',
        submit: 'Update PIN',
      };
    }

    return {
      title: 'Reset Password',
        subtitle: 'Choose a strong password to secure your account.',
      field: 'New Password',
      confirm: 'Confirm Password',
      submit: 'Update Password',
    };
  }, [isPinMode]);

  const validate = () => {
    if (!token) {
      showToast('Invalid Link', 'Reset link is missing or malformed.', 'error', 'reset-credential');
      return false;
    }

    if (!value || !confirmValue) {
      showToast('Missing Fields', 'Please fill in all required fields.', 'error', 'reset-credential');
      return false;
    }

    if (value !== confirmValue) {
      return false;
    }

    if (isPinMode) {
      if (!/^\d{6}$/.test(value)) {
        showToast('Invalid PIN', `PIN must be exactly ${PIN_LENGTH} digits.`, 'error', 'reset-credential');
        return false;
      }
      return true;
    }

    if (!isValidPassword(value)) {
      return false;
    }

    return true;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);

    try {
      if (isPinMode) {
        await resetPinApi(token, value);
        showToast('PIN Updated', 'Your PIN has been reset successfully.', 'success', 'reset-credential');
      } else {
        await resetPasswordApi(token, value);
        showToast('Password Updated', 'Your password has been reset successfully.', 'success', 'reset-credential');
      }

      setTimeout(() => navigate('/login', { replace: true }), 1000);
    } catch (error) {
      showToast('Reset Failed', error.message || 'Invalid or expired reset link.', 'error', 'reset-credential');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-reset-page min-h-screen bg-[#111827] p-4 flex items-center justify-center">
      <div className="auth-reset-card w-full max-w-md rounded-2xl bg-white shadow-2xl border border-gray-200">
        <div className="auth-reset-header px-6 pt-6 pb-4 border-b border-gray-100 text-center">
          <div className="mx-auto mb-2 h-12 w-12">
            <img src={logo} alt="Logo" className="h-full w-full object-contain rounded-full" />
          </div>
          <h2 className="auth-reset-title text-2xl font-semibold text-gray-900 tracking-tight">{labels.title}</h2>
          <p className="auth-reset-description text-xs text-gray-600 mt-1">{labels.subtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-reset-form p-6 space-y-4" autoComplete="off">
          {!token && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              Invalid reset token. Please request a new reset link.
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">{labels.field}</label>
            <div className="relative">
              <input
                type={isPinMode || !showNewPassword ? 'password' : 'text'}
                inputMode={isPinMode ? 'numeric' : undefined}
                maxLength={isPinMode ? PIN_LENGTH : undefined}
                value={value}
                onChange={(e) => {
                  const nextValue = isPinMode ? e.target.value.trim() : e.target.value;

                  if (!isPinMode) {
                    setValue(nextValue);
                    return;
                  }

                  const validatedPin = getValidatedPinInput(nextValue);
                  setValue(validatedPin === null ? '' : validatedPin);
                }}
                className={`auth-reset-input w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 outline-none ${
                  !isPinMode && value
                    ? (isPasswordValid ? 'border-green-300 focus:border-green-500 focus:ring-green-100' : 'border-rose-300 focus:border-rose-500 focus:ring-rose-100')
                    : 'border-gray-300 focus:border-gray-900 focus:ring-gray-200'
                } ${isPinMode ? '' : 'pr-10'}`}
                placeholder={isPinMode ? 'Enter 6-digit PIN' : 'Enter new password'}
              />
              {!isPinMode && (
                <button
                  type="button"
                  onClick={() => setShowNewPassword((visible) => !visible)}
                  className="auth-reset-eye absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600 focus:outline-none"
                  aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                >
                  {showNewPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              )}
            </div>
            {!isPinMode && (
              <div className="mt-2 px-0.5">
                <p className="mb-1.5 text-[10px] font-medium text-gray-500">Password requirements</p>
                <div className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2">
                  {PASSWORD_REQUIREMENTS.map((requirement) => {
                    const isMet = passwordChecks[requirement.key];
                    return (
                      <div key={requirement.key} className={`flex items-center gap-1.5 text-[10px] ${isMet ? 'text-emerald-700' : 'text-gray-500'}`}>
                        <span className={`inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-full text-[9px] ${isMet ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}>
                          {isMet ? '✓' : '•'}
                        </span>
                        {requirement.label}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">{labels.confirm}</label>
            <div className="relative">
              <input
                type={isPinMode || !showConfirmPassword ? 'password' : 'text'}
                inputMode={isPinMode ? 'numeric' : undefined}
                maxLength={isPinMode ? PIN_LENGTH : undefined}
                value={confirmValue}
                onChange={(e) => {
                  const nextValue = isPinMode ? e.target.value.trim() : e.target.value;

                  if (!isPinMode) {
                    setConfirmValue(nextValue);
                    return;
                  }

                  const validatedPin = getValidatedPinInput(nextValue);
                  setConfirmValue(validatedPin === null ? '' : validatedPin);
                }}
                className={`auth-reset-input w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 outline-none ${
                  passwordsDoNotMatch
                    ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-100'
                    : 'border-gray-300 focus:border-gray-900 focus:ring-gray-200'
                } ${isPinMode ? '' : 'pr-10'}`}
                placeholder={isPinMode ? 'Confirm 6-digit PIN' : 'Confirm new password'}
              />
              {!isPinMode && (
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((visible) => !visible)}
                  className="auth-reset-eye absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600 focus:outline-none"
                  aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                >
                  {showConfirmPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              )}
            </div>
            {passwordsDoNotMatch && <p className="mt-1 text-[11px] font-medium text-rose-600">Passwords do not match.</p>}
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !canSubmit}
            className="auth-reset-submit w-full h-10 rounded-xl bg-[#111827] text-white text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Saving...' : labels.submit}
          </button>

          <div className="text-center pt-1">
            <Link to="/login" className="auth-reset-back text-xs text-gray-600 hover:text-gray-900 hover:underline">
              Back to login
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ResetCredential;
