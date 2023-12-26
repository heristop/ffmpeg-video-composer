import { injectable } from 'tsyringe';
import { Section } from '../types';

@injectable()
class Segment {
  public currentSection: Section;

  public filtersList: string[] = [];
  public filtersMapList: string[] = [];
  public mapsList: string[] = [];
  public assetsDir: string = '';
  public fontsDir: string = '';
  public animationsDir: string = '';
  public tempFonts: string[] = [];
  public inputsAsset: string[] = [];
  public inputsMapCount: number = 0;
}

export default Segment;
