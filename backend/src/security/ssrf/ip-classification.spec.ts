import { describe, expect, it } from 'vitest';
import { isIpv4Private, isIpv6Private, isPrivateOrReservedIp } from './ip-classification.js';

describe('isIpv4Private', () => {
  it.each([
    ['0.0.0.0', true],
    ['127.0.0.1', true],
    ['127.255.255.255', true],
    ['10.0.0.1', true],
    ['10.255.255.255', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['192.168.0.1', true],
    ['192.168.255.255', true],
    ['169.254.169.254', true], // cloud metadata endpoint
    ['8.8.8.8', false],
    ['1.1.1.1', false],
    ['172.32.0.1', false], // just outside the 172.16.0.0/12 range
    ['172.15.255.255', false], // just below the range
    ['93.184.216.34', false], // example.com
  ])('%s -> private=%s', (ip, expected) => {
    expect(isIpv4Private(ip)).toBe(expected);
  });
});

describe('isIpv6Private', () => {
  it.each([
    ['::1', true],
    ['::', true],
    ['fe80::1', true],
    ['febf::1', true],
    ['fc00::1', true],
    ['fd12:3456::1', true],
    ['::ffff:127.0.0.1', true], // IPv4-mapped loopback
    ['::ffff:10.0.0.1', true], // IPv4-mapped private
    ['2001:4860:4860::8888', false], // Google public DNS
    ['2606:2800:220:1:248:1893:25c8:1946', false], // example.com
  ])('%s -> private=%s', (ip, expected) => {
    expect(isIpv6Private(ip)).toBe(expected);
  });
});

describe('isPrivateOrReservedIp', () => {
  it('dispatches to the right family check', () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
    expect(isPrivateOrReservedIp('::1')).toBe(true);
    expect(isPrivateOrReservedIp('2001:4860:4860::8888')).toBe(false);
  });

  it('fails closed for something that is not a recognizable IP literal', () => {
    expect(isPrivateOrReservedIp('not-an-ip')).toBe(true);
  });
});
