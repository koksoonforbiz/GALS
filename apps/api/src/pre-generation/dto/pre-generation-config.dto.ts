export type PreGenerationMode = 'all' | 'first5' | 'none';

export interface PreGenerationConfigDto {
  mode: PreGenerationMode;
  numberOfSets: 1 | 2 | 3;
}
