import { useEffect } from 'react';
import { installFormValidationNavigation } from '../utils/formValidationNavigation';

const FormValidationNavigation = () => {
  useEffect(() => installFormValidationNavigation(), []);
  return null;
};

export default FormValidationNavigation;
