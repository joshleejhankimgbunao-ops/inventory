import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  resetPasswordApi,
  resetPinApi,
} from '../services/authApi';
import { showToast } from '../utils/toastHelper';
import logo from '../assets/logo.png';

const PASSWORD_MIN_LENGTH = 8;
const PIN_LENGTH = 6;

const ResetCredential = ({ mode }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [value, setValue] = useState('');
  const [confirmValue, setConfirmValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isPinMode = mode === 'pin';

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
      subtitle: 'Enter a new password with letters and numbers.',
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
      showToast('Mismatch', 'The values do not match.', 'error', 'reset-credential');
      return false;
    }

    if (isPinMode) {
      if (!/^\d{6}$/.test(value)) {
        showToast('Invalid PIN', `PIN must be exactly ${PIN_LENGTH} digits.`, 'error', 'reset-credential');
        return false;
      }
      return true;
    }

    if (value.length < PASSWORD_MIN_LENGTH || !/[A-Za-z]/.test(value) || !/\d/.test(value)) {
      showToast(
        'Weak Password',
        `Password must be at least ${PASSWORD_MIN_LENGTH} characters and include letters and numbers.`,
        'error',
        'reset-credential'
      );
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
    <div className="min-h-screen bg-[#111827] p-4 flex items-center justify-center">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-gray-200">
        <div className="px-6 pt-6 pb-4 border-b border-gray-100 text-center">
          <div className="mx-auto mb-2 h-12 w-12">
            <img src={logo} alt="Logo" className="h-full w-full object-contain rounded-full" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">{labels.title}</h1>
          <p className="text-xs text-gray-600 mt-1">{labels.subtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4" autoComplete="off">
          {!token && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              Invalid reset token. Please request a new reset link.
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">{labels.field}</label>
            <input
              type={isPinMode ? 'password' : 'password'}
              inputMode={isPinMode ? 'numeric' : undefined}
              maxLength={isPinMode ? PIN_LENGTH : undefined}
              value={value}
              onChange={(e) => setValue(e.target.value.trim())}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-2 focus:ring-gray-200 outline-none"
              placeholder={isPinMode ? 'Enter 6-digit PIN' : 'Enter new password'}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">{labels.confirm}</label>
            <input
              type={isPinMode ? 'password' : 'password'}
              inputMode={isPinMode ? 'numeric' : undefined}
              maxLength={isPinMode ? PIN_LENGTH : undefined}
              value={confirmValue}
              onChange={(e) => setConfirmValue(e.target.value.trim())}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-2 focus:ring-gray-200 outline-none"
              placeholder={isPinMode ? 'Confirm 6-digit PIN' : 'Confirm new password'}
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !token}
            className="w-full h-10 rounded-xl bg-[#111827] text-white text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Saving...' : labels.submit}
          </button>

          <div className="text-center pt-1">
            <Link to="/login" className="text-xs text-gray-600 hover:text-gray-900 hover:underline">
              Back to login
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ResetCredential;
