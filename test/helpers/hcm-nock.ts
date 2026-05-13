import nock from 'nock';

const HCM_BASE = 'http://localhost:3001';

export function nockGetBalance(
  employeeId: string,
  locationId: string,
  leaveType: string,
  availableBalance: number,
) {
  return nock(HCM_BASE)
    .get(`/hcm/balances/${employeeId}/${locationId}/${leaveType}`)
    .reply(200, { availableBalance });
}

export function nockDeductBalance(hcmReferenceId: string, newBalance: number) {
  return nock(HCM_BASE)
    .post('/hcm/balances/deduct')
    .reply(200, { hcmReferenceId, newBalance });
}

export function nockDeductBalanceInsufficient() {
  return nock(HCM_BASE)
    .post('/hcm/balances/deduct')
    .reply(422, { message: 'Insufficient balance' });
}

export function nockDeductBalanceUnavailable() {
  return nock(HCM_BASE)
    .post('/hcm/balances/deduct')
    .reply(503, { message: 'Service unavailable' });
}

export function nockCreditBalance() {
  return nock(HCM_BASE)
    .post('/hcm/balances/credit')
    .reply(200, { newBalance: 12 });
}
