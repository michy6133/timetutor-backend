const http = require('http');

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/v1/sessions/13511eb0-fa0d-444f-b6bd-b97bdc2a9a5a/slots', // using a fake UUID, we will use my local session UUID
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    // How to get token? I don't have it.
  }
}, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log(res.statusCode, data));
});
req.end(JSON.stringify({ dayOfWeek: 'Lundi', startTime: '08:00', endTime: '09:00', room: '' }));
