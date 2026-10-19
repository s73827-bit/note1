// 테스트 설정. 앱은 index.html을 file://로 바로 열어서 확인합니다.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    channel: 'chrome',          // 설치된 Chrome 사용 (브라우저 따로 받지 않음)
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure'
  }
});
