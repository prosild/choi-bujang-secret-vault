import assert from 'node:assert/strict';
import { test } from 'node:test';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import session from '../api/session.js';
import notes from '../api/notes.js';
test('서버 세션과 쿠키 기반 메모 접근을 검증한다', async () => {
const origin='https://ocacvvmryvtqajlmosqj.supabase.co',app='https://choi-bujang-secret-vault-aleph17.vercel.app',uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
process.env.SUPABASE_URL=origin;process.env.SUPABASE_SECRET_KEY='fixture-secret';
const keys=await generateKeyPair('ES256'),jwk={...await exportJWK(keys.publicKey),kid:'fixture',alg:'ES256',use:'sig'};
const token=await new SignJWT({role:'authenticated'}).setProtectedHeader({alg:'ES256',kid:'fixture'}).setIssuer(origin+'/auth/v1').setAudience('authenticated').setSubject(uid).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
const user={id:uid,email:'fixture' + '@' + 'example.test',aud:'authenticated',role:'authenticated'};
const tokens={access_token:token,refresh_token:'fixture-refresh',token_type:'bearer',expires_in:300,user};
let refreshes=0;
globalThis.fetch=async(input,init={})=>{const u=new URL(input instanceof Request?input.url:String(input));if(u.pathname.endsWith('/.well-known/jwks.json'))return Response.json({keys:[jwk]});if(u.pathname==='/auth/v1/token'){if(u.searchParams.get('grant_type')==='refresh_token')refreshes++;return Response.json(tokens)}if(u.pathname==='/auth/v1/user')return Response.json(user);if(u.pathname==='/auth/v1/logout')return new Response(null,{status:204});if(u.pathname==='/rest/v1/study_notes')return Response.json([]);throw Error('unexpected mock route')};
async function call(fn,method,{cookie,body,origin:originHeader=app,authorization,query}={}){let status,bodyOut;const headers={};const res={setHeader(k,v){headers[k.toLowerCase()]=v},status(n){status=n;return this},json(v){bodyOut=v;return this}};await fn({method,headers:{origin:originHeader,cookie,authorization},body,query},res);return {status,body:bodyOut,headers};}
let out=await call(session,'POST',{body:{email:'fixture' + '@' + 'example.test',password:'fixture'}});assert.equal(out.status,200);assert.deepEqual(Object.keys(out.body),['user']);assert.equal(JSON.stringify(out.body).includes(token),false);assert.equal(out.headers['set-cookie'].length,2);assert.ok(out.headers['set-cookie'].every(c=>c.includes('HttpOnly')&&c.includes('Secure')&&c.includes('SameSite=Strict')));
let cookie=out.headers['set-cookie'].map(x=>x.split(';')[0]).join('; ');
out=await call(notes,'GET',{cookie});assert.equal(out.status,200);assert.deepEqual(out.body,{notes:[]});
out=await call(notes,'POST',{cookie,origin:'https://evil.example',body:{title:'x',body:'x'}});assert.equal(out.status,403);
out=await call(session,'POST',{origin:'https://evil.example',body:{email:'x',password:'x'}});assert.equal(out.status,403);
out=await call(session,'GET',{cookie});assert.equal(out.status,200);assert.equal(out.body.user.id,uid);
out=await call(session,'GET',{cookie:cookie.split('; ').find(v=>v.startsWith('__Host-vault-refresh='))});assert.equal(out.status,200);assert.equal(refreshes,1);assert.equal(out.headers['set-cookie'].length,2);
out=await call(session,'DELETE',{cookie});assert.equal(out.status,200);assert.ok(out.headers['set-cookie'].every(x=>x.includes('Max-Age=0')));
out=await call(session,'GET');assert.equal(out.status,401);
console.log('서버 세션 모의 검사: 로그인, 안전 쿠키, 토큰 비노출, 세션 복원·갱신, 출처 검사, 메모 접근, 로그아웃 통과');

});
