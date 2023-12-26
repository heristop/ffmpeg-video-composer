abstract class AbstractFilesystem {
  protected root: string | undefined;
  protected tempDir: string | undefined;
  protected segmentName: string | undefined;
  protected buildDir: string | undefined;
  protected assetsDir: string | undefined;

  abstract getAssetsPath(dir: string): Promise<string>;
  abstract getBuildPath(buildDir: string): Promise<string>;
  abstract getSource(segmentName?: string | undefined): string;
  abstract getDestination(): string;
  abstract stat(filePath: string): Promise<boolean>;
  abstract fetch(url: string): Promise<string>;
  abstract write(targetPath: string): Promise<void>;
  abstract append(targetPath: string, file: string): Promise<void>;
  abstract unlink(path: string): Promise<void>;
  abstract read(filePath: string): Promise<string>;
  abstract copy(sourcePath: string, targetPath: string): Promise<void>;
  abstract move(sourcePath: string, targetPath: string): Promise<void>;
  abstract unzip(url: string, targetPath: string): Promise<string[]>;
  abstract fetchAndRead(url: string): Promise<string>;

  setBuildDir = (buildDir: string) => {
    this.buildDir = `${this.root}/${buildDir}`;
  };

  getBuildDir = (): string | undefined => this.buildDir;

  setAssetsDir = (assetsDir: string) => {
    this.assetsDir = `${this.root}/${assetsDir}`;
  };

  getAssetsDir = (assetsType: string): string | undefined => `${this.assetsDir}/${assetsType}`;

  getRootDir = (): string | undefined => this.root;

  setSegment = (segmentName: string) => {
    this.segmentName = segmentName;
  };

  getTempDir = () => {
    return this.tempDir;
  };
}

export default AbstractFilesystem;
