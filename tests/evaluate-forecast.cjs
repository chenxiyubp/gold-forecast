// Usage: node tests/evaluate-forecast.cjs /path/to/sge-daily-response.json /path/to/report.json
const fs=require('node:fs'),crypto=require('node:crypto');
const C=require('../app/src/main/assets/core.js'),F=require('../app/src/main/assets/forecast.js');
const input=fs.readFileSync(process.argv[2]),history=C.parseHistory(JSON.parse(input));
const result=F.run(history),report={evaluatedAt:new Date().toISOString(),inputSha256:crypto.createHash('sha256').update(input).digest('hex'),
 method:'ATR14 + prior 120 excursion/ATR 90th empirical percentile; centered on previous close',
 samples:result.samples,baseDate:result.baseDate,available:result.available,quality:result.quality,
 prediction:result.prediction,alignment:result.alignment,validation:result.validation};
fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,validation:{...report.validation,records:undefined}},null,2));
