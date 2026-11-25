const { withSettingsGradle } = require('expo/config-plugins');

// Android doesn't allow a project name ending in "." ("bagged."), so use a
// plain internal name. The name people see on the phone stays "bagged."
module.exports = function withAndroidProjectName(config) {
  return withSettingsGradle(config, (cfg) => {
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /rootProject\.name\s*=\s*['"][^'"]*['"]/,
      "rootProject.name = 'bagged'"
    );
    return cfg;
  });
};
