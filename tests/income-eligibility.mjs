import fs from 'node:fs';import assert from 'node:assert/strict';
const code=fs.readFileSync('src/eligibility.js','utf8');const {evaluateIncomeEligibility:e,isValidCertificationUrl}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
for (const [income,amount,expected] of [[90000,675,'request_not_high_enough'],[90000,675.01,'eligible'],[90000.01,1000,'over_income_limit'],[0,0.01,'eligible'],[40000,300,'request_not_high_enough'],[40000,300.01,'eligible'],[-1,10,'invalid'],[0,0,'invalid']]) assert.equal(e(income,amount),expected,`${income}/${amount}`);
for (const url of ['https://example.com/certification','http://certifications.example.org:8080/path?x=1','https://xn--e1afmkfd.xn--p1ai']) assert.equal(isValidCertificationUrl(url),true,url);
for (const url of ['https://.','https://example.com:99999','https://user:secret@example.com','javascript:alert(1)','https://localhost/test','https://example.com./test']) assert.equal(isValidCertificationUrl(url),false,url);
console.log('Eligibility boundary checks passed: $90,000, over $90,000, 0.75% equality, above threshold and zero income.');
