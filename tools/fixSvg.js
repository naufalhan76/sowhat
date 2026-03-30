const fs = require('fs');
let c = fs.readFileSync('a:/Solofleet/frontend/src/App.jsx','utf8');
c = c.replace(/<path d={temp1Path} fill="none" stroke="#2563eb" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" \/>/, `{temp1Path ? <path d={\`\${temp1Path} L \${xFor(timeEnd)} \${height - padding.bottom} L \${xFor(timeStart)} \${height - padding.bottom} Z\`} fill="url(#fillTemp1)" /> : null}\n      <path d={temp1Path} fill="none" stroke="#F97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />`);
c = c.replace(/<path d={temp2Path} fill="none" stroke="#0ea5e9" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" \/>/, `{temp2Path ? <path d={\`\${temp2Path} L \${xFor(timeEnd)} \${height - padding.bottom} L \${xFor(timeStart)} \${height - padding.bottom} Z\`} fill="url(#fillTemp2)" /> : null}\n      <path d={temp2Path} fill="none" stroke="#3B82F6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />`);
c = c.replace(/stroke="rgba\(64,\s*120,\s*214,\s*0\.18\)"/g, 'stroke="rgba(255, 255, 255, 0.08)"');
c = c.replace(/stroke="rgba\(64,\s*120,\s*214,\s*0\.08\)"/g, 'stroke="rgba(255, 255, 255, 0.04)"');
c = c.replace(/fill="rgba\(77,\s*102,\s*152,\s*0\.9\)"/g, 'fill="rgba(255, 255, 255, 0.4)"');
fs.writeFileSync('a:/Solofleet/frontend/src/App.jsx', c);
console.log('SVG style fixed');
