import { Modal, ScrollView, View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { Section, Project } from '@/src/types';
import FormSection from '@/src/features/editor/components/FormSection';
import { colors } from '@/src/styles/theme';
import { PressableScale } from '@/src/components/kinetic/pressable-scale';
import { styles } from '@/src/features/templates/detail/detail.styles';

interface FormModalProps {
  section: Section | null;
  formData: Project['formData'];
  onFormDataChange: (field: string, value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export function FormModal({ section, formData, onFormDataChange, onClose, onSubmit }: FormModalProps) {
  const { t } = useTranslation('common');

  if (!section) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.formModalContainer} edges={['top', 'bottom', 'left', 'right']}>
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>{section.title?.en ?? section.name}</Text>
            <PressableScale onPress={onClose} accessibilityLabel={t('actions.done')}>
              <Ionicons name="close" size={26} color={colors.textStrong} />
            </PressableScale>
          </View>
          <ScrollView>
            <FormSection
              section={section}
              formData={formData as Record<string, string>}
              onFormDataChange={onFormDataChange}
            />
          </ScrollView>
          <View style={styles.formFooter}>
            <PressableScale style={styles.formSubmitButton} onPress={onSubmit} haptic="medium">
              <Text style={styles.formSubmitButtonText}>{t('actions.done')}</Text>
            </PressableScale>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

export default FormModal;
