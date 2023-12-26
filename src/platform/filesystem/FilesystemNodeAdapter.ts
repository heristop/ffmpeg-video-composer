import { inject, injectable } from 'tsyringe';
import { promises as fs, createWriteStream } from 'fs';
import path from 'path';
import axios from 'axios';
import extract from 'extract-zip';
import os from 'os';
import AbstractFilesystem from './AbstractFilesystem';
import AbstractLogger from '../logging/AbstractLogger';

@injectable()
class FilesystemNodeAdapter extends AbstractFilesystem {
  protected root: string = process.cwd();
  protected tempDir: string = os.tmpdir();

  constructor(@inject('logger') private readonly logger: AbstractLogger) {
    super();
  }

  getAssetsPath = async (dir: string): Promise<string> => {
    const fullPath = path.join(this.root, 'src', 'shared', 'assets', dir);

    return fullPath;
  };

  getBuildPath = async (dir: string): Promise<string> => {
    const fullPath = path.join(this.buildDir, dir);
    await fs.mkdir(fullPath, { recursive: true });

    return fullPath;
  };

  getSource = (segmentName: string | undefined): string => {
    if (!segmentName) {
      segmentName = this.segmentName;
    }

    return path.join(this.assetsDir, 'videos', `${segmentName}.mp4`); // @fixme
  };

  getDestination = (): string => path.join(this.buildDir, `${this.segmentName}_output.mp4`);

  fetch = async (url: string): Promise<string> => {
    const dest = path.join(this.tempDir, path.basename(url));

    const response = await axios({
      method: 'get',
      url,
      responseType: 'stream',
    });

    const writer = createWriteStream(dest);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    return dest;
  };

  stat = async (filePath: string): Promise<boolean> => {
    try {
      await fs.stat(filePath);
      return true;
    } catch {
      return false;
    }
  };

  read = async (filePath: string): Promise<string> => {
    return await fs.readFile(filePath, 'utf-8');
  };

  copy = async (sourcePath: string, targetPath: string): Promise<void> => {
    return await fs.copyFile(sourcePath, targetPath);
  };

  move = async (sourcePath: string, targetPath: string): Promise<void> => {
    if (
      await fs
        .access(sourcePath)
        .then(() => true)
        .catch(() => false)
    ) {
      return fs.rename(sourcePath, targetPath);
    }

    throw new Error(`${sourcePath} not found`);
  };

  unlink = (filePath: string): Promise<void> => {
    this.write(filePath);

    return fs.unlink(filePath);
  };

  write = (targetPath: string): Promise<void> => fs.writeFile(targetPath, '');

  append = async (targetPath: string, content: string): Promise<void> => {
    if (
      !(await fs
        .access(targetPath)
        .then(() => true)
        .catch(() => false))
    ) {
      throw new Error(`${targetPath} doesn't exist`);
    }

    return fs.appendFile(targetPath, content);
  };

  unzip = async (zipPath: string, targetPath: string): Promise<string[]> => {
    await extract(zipPath, { dir: targetPath });
    const files = await fs.readdir(targetPath);

    return files.map((file) => path.join(targetPath, file));
  };

  fetchAndRead = async (url: string): Promise<string> => {
    try {
      const response = await axios.get(url);
      return response.data;
    } catch (err) {
      this.logger.error(`Error downloading from ${url}:`, err);
      throw err;
    }
  };
}

export default FilesystemNodeAdapter;
