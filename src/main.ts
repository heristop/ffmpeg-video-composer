import { compile, loadConfig } from '.';

const configFilePath = globalThis.process.argv[2];

async function main(configFilePath: string): Promise<boolean> {
  const templateDescriptor = await loadConfig(`${configFilePath}`);

  const projectConfig = {
    assetsDir: './src/shared/assets',
    fields: {
      form_1_firstname: 'Emily',
      form_1_lastname: 'Parker',
      form_1_job: 'Frontend Developer',
      form_2_keyword1: 'php',
      form_2_keyword2: 'javascript',
      form_2_keyword3: 'typescript',
      form_2_keyword4: 'caffeine',
    },
  };

  return await compile(projectConfig, templateDescriptor);
}

if (configFilePath) {
  (async () => {
    try {
      await main(configFilePath);
    } catch (error) {
      globalThis.console.error(error);
      globalThis.process.exit(1);
    }
  })();
}

export { main };
