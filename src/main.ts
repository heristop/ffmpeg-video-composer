import { compile, loadConfig } from '.';

const configFilePath = globalThis.process.argv[2];

async function main(configFilePath: string): Promise<boolean> {
  const templateDescriptor = await loadConfig(`${configFilePath}`);

  const projectConfig = {
    assetsDir: './src/shared/assets',
    fields: {
      form_1_firstname: 'John',
      form_1_lastname: 'Doe',
      form_1_job: 'Developer',
      form_2_keyword1: 'One',
      form_2_keyword2: 'Two',
      form_2_keyword3: 'Three',
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
