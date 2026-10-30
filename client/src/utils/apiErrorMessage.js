const NETWORK_ERROR_MESSAGE = 'Unable to reach EvalPortal. Check your connection and try again.';
const SERVER_ERROR_MESSAGE = 'The server could not complete this request. Please try again shortly.';

export function getFriendlyApiErrorMessage(error) {
  const response = error?.response;
  if (!response) return NETWORK_ERROR_MESSAGE;

  const { status, data } = response;
  if (status >= 500) return SERVER_ERROR_MESSAGE;

  const serverMessage = typeof data?.message === 'string' ? data.message.trim() : '';
  if (serverMessage) return serverMessage;

  if (status === 401) {
    return error.config?.url?.includes('/auth/login')
      ? 'Sign-in failed. Check your email and password and try again.'
      : 'Your session has expired. Please sign in again.';
  }
  if (status === 403) return 'You do not have permission to perform this action.';
  if (status === 404) return 'The requested information could not be found. Refresh the page and try again.';
  if (status === 400 || status === 422) return 'Please check the information and try again.';
  return 'This request could not be completed. Please try again.';
}