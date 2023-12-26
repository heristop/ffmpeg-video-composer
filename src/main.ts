import { compile, loadConfig } from '.';

const configFilePath = process.argv[2];

async function main(configFilePath: string): Promise<boolean> {
  const templateDescriptor = await loadConfig(`./src/shared/templates/${configFilePath}`);

  const projectConfig = {
    assetsDir: './src/shared/assets',
    fields: {
      form_1_firstname: 'Alexandre',
      form_1_lastname: 'Mogère',
      form_1_job: 'Chapter Lead',
      form_2_keyword1: 'One',
      form_2_keyword2: 'Two',
      form_2_keyword3: 'Three',
    },
  };

  return await compile(projectConfig, templateDescriptor);
}

if (configFilePath) {
  await main(configFilePath);
}

export { main };
