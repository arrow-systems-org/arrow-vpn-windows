import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNodeUri,
  parseSubscriptionText,
  buildProxyOutbound,
  stableNodeId,
  sanitizeNode
} from '../protocols.js';

const uuid = '86690134-7a3f-4291-b9b5-aa027b01d719';

test('VLESS Reality + XHTTP is rendered for sing-box-lx', () => {
  const extra = encodeURIComponent(JSON.stringify({
    xPaddingBytes: '100-1000',
    noGRPCHeader: false,
    xmux: { maxConcurrency: '2-4', hKeepAlivePeriod: 30 }
  }));
  const raw = `vless://${uuid}@example.com:443?security=reality&sni=ads.x5.ru&fp=chrome&pbk=abc&sid=0123&type=xhttp&mode=auto&path=%2Fassets-v3%2F&extra=${extra}#%F0%9F%87%A9%F0%9F%87%AA%20Germany`;
  const node = parseNodeUri(raw);
  const out = buildProxyOutbound(node, '193.0.2.10');
  assert.equal(out.type, 'vless');
  assert.equal(out.server, '193.0.2.10');
  assert.equal(out.tls.reality.public_key, 'abc');
  assert.equal(out.tls.server_name, 'ads.x5.ru');
  assert.equal(out.transport.type, 'xhttp');
  assert.equal(out.transport.mode, 'auto');
  assert.equal(out.transport.path, '/assets-v3/');
  assert.equal(out.transport.x_padding_bytes, '100-1000');
  assert.deepEqual(out.transport.xmux, { max_concurrency: '2-4', h_keep_alive_period: 30 });
});

test('REALITY key_share and fragmentation are preserved for lx.4', () => {
  const raw = `vless://${uuid}@example.com:443?security=reality&sni=example.org&fp=chrome&pbk=abc&sid=deadbeef&type=tcp&key_share=hybrid&record_fragment=1&fragment=1`;
  const out = buildProxyOutbound(raw, '203.0.113.5');
  assert.equal(out.tls.reality.key_share, 'hybrid');
  assert.equal(out.tls.record_fragment, true);
  assert.equal(out.tls.fragment, true);
});

test('VLESS post-quantum encryption field is passed through', () => {
  const encryption = 'mlkem768x25519plus.native.0rtt.example-key';
  const raw = `vless://${uuid}@example.com:443?security=tls&type=ws&path=%2Fws&encryption=${encodeURIComponent(encryption)}`;
  const out = buildProxyOutbound(raw, '203.0.113.6');
  assert.equal(out.encryption, encryption);
  assert.equal(out.transport.type, 'ws');
});

test('Trojan share links produce Trojan outbounds', () => {
  const raw = 'trojan://secret@example.com:443?security=tls&sni=example.com&type=grpc&serviceName=svc#Trojan';
  const out = buildProxyOutbound(raw, '203.0.113.7');
  assert.equal(out.type, 'trojan');
  assert.equal(out.password, 'secret');
  assert.equal(out.transport.type, 'grpc');
  assert.equal(out.transport.service_name, 'svc');
});

test('Hysteria2 and TUIC share links are supported', () => {
  const hy = buildProxyOutbound('hysteria2://pass@example.com:443?sni=cdn.example.com&obfs=salamander&obfs-password=xyz#HY2', '203.0.113.8');
  assert.equal(hy.type, 'hysteria2');
  assert.equal(hy.obfs.type, 'salamander');
  assert.equal(hy.tls.server_name, 'cdn.example.com');

  const tuic = buildProxyOutbound(`tuic://${uuid}:pass@example.com:443?sni=example.com&congestion_control=bbr&alpn=h3#TUIC`, '203.0.113.9');
  assert.equal(tuic.type, 'tuic');
  assert.equal(tuic.congestion_control, 'bbr');
  assert.equal(tuic.tls.alpn[0], 'h3');
});

test('VMess base64 links are parsed', () => {
  const obj = { v: '2', ps: 'VMess node', add: 'example.com', port: '443', id: uuid, aid: '0', scy: 'auto', net: 'ws', host: 'example.com', path: '/vm', tls: 'tls', sni: 'example.com' };
  const raw = `vmess://${Buffer.from(JSON.stringify(obj)).toString('base64')}`;
  const node = parseNodeUri(raw);
  const out = buildProxyOutbound(node, '203.0.113.10');
  assert.equal(node.protocol, 'vmess');
  assert.equal(out.transport.type, 'ws');
  assert.equal(out.tls.enabled, true);
});

test('Shadowsocks SIP002 links are parsed', () => {
  const creds = Buffer.from('chacha20-ietf-poly1305:password').toString('base64url');
  const raw = `ss://${creds}@example.com:8388#SS`;
  const out = buildProxyOutbound(raw, '203.0.113.11');
  assert.equal(out.type, 'shadowsocks');
  assert.equal(out.method, 'chacha20-ietf-poly1305');
  assert.equal(out.password, 'password');
});

test('plain and base64 subscriptions accept multiple providers/protocols', () => {
  const lines = [
    `vless://${uuid}@a.example:443?security=tls#A`,
    'trojan://secret@b.example:443?security=tls#B'
  ].join('\n');
  assert.equal(parseSubscriptionText(lines).length, 2);
  assert.equal(parseSubscriptionText(Buffer.from(lines).toString('base64')).length, 2);
});

test('stable IDs do not collide just because nodes share a hostname', () => {
  const a = `vless://${uuid}@same.example:443?security=tls#A`;
  const b = `vless://c6360769-0493-4c77-aba9-63fd033f9d49@same.example:443?security=tls#B`;
  assert.notEqual(stableNodeId(a), stableNodeId(b));
});

test('sanitized node metadata never exposes raw credentials', () => {
  const raw = `vless://${uuid}@example.com:443?security=reality&pbk=secret#Node`;
  const clean = sanitizeNode(parseNodeUri(raw));
  assert.equal(Object.hasOwn(clean, 'raw'), false);
  assert.equal(JSON.stringify(clean).includes(uuid), false);
  assert.equal(JSON.stringify(clean).includes('secret'), false);
});
