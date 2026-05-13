export class HcmInsufficientBalanceError extends Error {
  constructor(message = 'HCM: insufficient balance') {
    super(message);
    this.name = 'HcmInsufficientBalanceError';
  }
}

export class HcmUnavailableError extends Error {
  constructor(message = 'HCM: service unavailable') {
    super(message);
    this.name = 'HcmUnavailableError';
  }
}

export class HcmInvalidDimensionsError extends Error {
  constructor(
    message = 'HCM: invalid dimensions (employee/location/leaveType)',
  ) {
    super(message);
    this.name = 'HcmInvalidDimensionsError';
  }
}
