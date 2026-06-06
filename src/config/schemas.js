import { 
  Info, BarChart3, HelpCircle, GraduationCap, Award, CheckSquare, 
  FileText, CreditCard, Landmark, Table, BookOpen, UserCheck, 
  Briefcase, Star, MessageSquare 
} from 'lucide-react';

export const PAGE_TYPES = {
  UNIVERSITY: 'university',
  COURSE: 'course',
  SPECIALIZATION: 'specialization'
};

export const SCHEMA_DETAILS = {
  [PAGE_TYPES.UNIVERSITY]: {
    id: PAGE_TYPES.UNIVERSITY,
    title: 'University Page',
    fieldCount: 22,
    estimatedTime: '20 mins',
  },
  [PAGE_TYPES.COURSE]: {
    id: PAGE_TYPES.COURSE,
    title: 'Course Page',
    fieldCount: 20,
    estimatedTime: '18 mins',
  },
  [PAGE_TYPES.SPECIALIZATION]: {
    id: PAGE_TYPES.SPECIALIZATION,
    title: 'Specialization Page',
    fieldCount: 54,
    estimatedTime: '30 mins',
  }
};

export const schemas = {
  [PAGE_TYPES.SPECIALIZATION]: {
    id: PAGE_TYPES.SPECIALIZATION,
    title: 'Specialization Page',
    sections: [
      {
        id: 'basic_info',
        title: 'Basic Info',
        icon: 'Info',
        fields: [
          { key: 'spec_name', type: 'TEXT_INPUT', label: 'Specialization Name', placeholder: 'e.g. MBA in Marketing Management', required: true },
          { key: 'university_name', type: 'TEXT_INPUT', label: 'University Name', placeholder: 'e.g. NMIMS', required: true },
          { key: 'university_full_name', type: 'TEXT_INPUT', label: 'University Full Name', placeholder: 'e.g. Narsee Monjee Institute...' },
          { key: 'spec_tag_label', type: 'TEXT_INPUT', label: 'Hero Tag Line', placeholder: 'e.g. MBA Specialization · Marketing' },
          { key: 'hero_description', type: 'TEXTAREA', label: 'Hero Short Description (1-2 lines)', placeholder: 'Shown below the title in the hero section', required: true, rows: 3 },
          { 
            key: 'badges', 
            type: 'BADGE_SELECTOR', 
            label: 'Badges', 
            options: ["UGC Approved", "NAAC A++", "NAAC A+", "NAAC A", "100% Online", "2 Years", "Working Professionals", "AIU Member", "AICTE Approved"] 
          }
        ]
      },
      {
        id: 'hero_stats',
        title: 'Hero Stats',
        icon: 'BarChart3',
        description: 'These 5 numbers appear in the hero bar',
        fields: [
          { key: 'stat_best_price', type: 'TEXT_INPUT', label: 'Best Price', placeholder: 'e.g. ₹1.96L' },
          { key: 'stat_duration', type: 'TEXT_INPUT', label: 'Duration', placeholder: 'e.g. 2 Yrs' },
          { key: 'stat_faculty', type: 'TEXT_INPUT', label: 'Faculty Stat', placeholder: 'e.g. 120+' },
          { key: 'stat_hiring_firms', type: 'TEXT_INPUT', label: 'Hiring Firms', placeholder: 'e.g. 8K+' },
          { key: 'stat_top_salary', type: 'TEXT_INPUT', label: 'Top Salary', placeholder: 'e.g. ₹10 LPA' }
        ]
      },
      {
        id: 'about_spec',
        title: 'About the Specialization',
        icon: 'GraduationCap',
        fields: [
          { key: 'spec_about', type: 'RICH_TEXT', label: 'About Content', placeholder: 'Full description of the specialization', required: true },
          { key: 'fact_duration', type: 'TEXT_INPUT', label: 'Fact Card 1 — Duration', placeholder: 'e.g. 2 Yrs' },
          { key: 'fact_validity', type: 'TEXT_INPUT', label: 'Fact Card 2 — Validity', placeholder: 'e.g. 4 Yrs' },
          { key: 'fact_faculty_count', type: 'TEXT_INPUT', label: 'Fact Card 3 — Faculty', placeholder: 'e.g. 120+' },
          { key: 'pros_list', type: 'LIST_BUILDER', label: 'Key Advantages (shown as checkmarks)', placeholder: 'e.g. World-class faculty: 120+ IIT...', required: true }
        ]
      },
      {
        id: 'highlights',
        title: 'Program Highlights',
        icon: 'Award',
        fields: [
          { key: 'course_facts', type: 'LIST_BUILDER', label: 'Program Highlight Points', placeholder: 'e.g. 2-Year PG Degree, 4-Year Validity', required: true }
        ]
      },
      {
        id: 'eligibility',
        title: 'Eligibility',
        icon: 'CheckSquare',
        fields: [
          { key: 'eligibility_education', type: 'TEXTAREA', label: 'Education Qualification', placeholder: 'e.g. Completed a bachelor\'s degree...', required: true, rows: 3 },
          { key: 'eligibility_marks', type: 'TEXTAREA', label: 'Minimum Marks Requirement', placeholder: 'e.g. Minimum 50% aggregate...', rows: 2 },
          { key: 'admission_fee_note', type: 'TEXT_INPUT', label: 'Admission Fee Note', placeholder: 'e.g. ₹1,200/- one-time non-refundable' }
        ]
      },
      {
        id: 'fee_structure',
        title: 'Fee Structure',
        icon: 'CreditCard',
        description: '3 Payment Plans',
        fields: [
          { key: 'fee_semester_amount', type: 'TEXT_INPUT', label: 'Semester Plan — Per Semester Amount', placeholder: 'e.g. ₹55,000' },
          { key: 'fee_semester_total', type: 'TEXT_INPUT', label: 'Semester Plan — Total', placeholder: 'e.g. ₹2,20,000' },
          { key: 'fee_annual_amount', type: 'TEXT_INPUT', label: 'Annual Plan — Per Year Amount', placeholder: 'e.g. ₹1,05,000' },
          { key: 'fee_annual_total', type: 'TEXT_INPUT', label: 'Annual Plan — Total', placeholder: 'e.g. ₹2,10,000' },
          { key: 'fee_onetime_amount', type: 'TEXT_INPUT', label: 'One-Time Payment Amount (Best Value)', placeholder: 'e.g. ₹1,96,000', required: true },
          { key: 'fee_savings_note', type: 'TEXT_INPUT', label: 'Savings Note for One-Time', placeholder: 'e.g. Save ₹24,000' }
        ]
      },
      {
        id: 'emi',
        title: 'EMI',
        icon: 'Landmark',
        fields: [
          { key: 'emi_starting_amount', type: 'TEXT_INPUT', label: 'EMI Starting From (per month)', placeholder: 'e.g. ₹8,750', required: true },
          { key: 'emi_tenures', type: 'LIST_BUILDER', label: 'Available EMI Tenures (months)', placeholder: 'e.g. 3, 6, 9, 12' },
          { key: 'emi_highlighted_tenure', type: 'TEXT_INPUT', label: 'Highlighted/Best Tenure', placeholder: 'e.g. 12' },
          { key: 'emi_partner_banks', type: 'LIST_BUILDER', label: 'Partner Banks', placeholder: 'e.g. HDFC Bank' },
          { key: 'scholarship_note', type: 'TEXTAREA', label: 'Scholarship Note', placeholder: 'e.g. Merit & need-based tuition relief...', rows: 2 }
        ]
      },
      {
        id: 'other_specs',
        title: 'Other Specializations Table',
        icon: 'Table',
        fields: [
          { key: 'specialization_fees', type: 'TABLE_BUILDER', label: 'All Specializations & Fees', columns: ['specialization', 'fee_per_semester'], required: true }
        ]
      },
      {
        id: 'syllabus',
        title: 'Syllabus',
        icon: 'BookOpen',
        description: 'Enter subjects for each semester',
        fields: [
          { key: 'syllabus_y1_s1', type: 'LIST_BUILDER', label: 'Year 1 — Semester 1 Subjects', required: true },
          { key: 'syllabus_y1_s2', type: 'LIST_BUILDER', label: 'Year 1 — Semester 2 Subjects', required: true },
          { key: 'syllabus_y2_s3', type: 'LIST_BUILDER', label: 'Year 2 — Semester 3 Subjects', required: true },
          { key: 'syllabus_y2_s4', type: 'LIST_BUILDER', label: 'Year 2 — Semester 4 Subjects', required: true }
        ]
      },
      {
        id: 'examination',
        title: 'Examination',
        icon: 'FileText',
        fields: [
          { key: 'exam_pattern', type: 'TEXTAREA', label: 'Examination Pattern Description', placeholder: 'e.g. Online proctored platform...', rows: 4 }
        ]
      },
      {
        id: 'admission_process_sec',
        title: 'Admission Process',
        icon: 'UserCheck',
        fields: [
          { key: 'admission_process', type: 'STEP_BUILDER', label: 'Admission Steps', required: true }
        ]
      },
      {
        id: 'placement',
        title: 'Placement',
        icon: 'Briefcase',
        fields: [
          { key: 'placement_stat_1_value', type: 'TEXT_INPUT', label: 'Stat 1 Value', placeholder: 'e.g. 40%' },
          { key: 'placement_stat_1_label', type: 'TEXT_INPUT', label: 'Stat 1 Label', placeholder: 'e.g. Profile ranking improvement' },
          { key: 'placement_stat_2_value', type: 'TEXT_INPUT', label: 'Stat 2 Value', placeholder: 'e.g. 500+' },
          { key: 'placement_stat_2_label', type: 'TEXT_INPUT', label: 'Stat 2 Label', placeholder: 'e.g. Hiring partners' },
          { key: 'placement_stat_3_value', type: 'TEXT_INPUT', label: 'Stat 3 Value', placeholder: 'e.g. 6 mo' },
          { key: 'placement_stat_3_label', type: 'TEXT_INPUT', label: 'Stat 3 Label', placeholder: 'e.g. Job portal access' },
          { key: 'placement_services', type: 'LIST_BUILDER', label: 'Career Services List', placeholder: 'e.g. Job portal access (IIMJobs...)' },
          { key: 'placement_partners', type: 'LIST_BUILDER', label: 'Top Hiring Partners', placeholder: 'e.g. ICICI Securities', required: true }
        ]
      },
      {
        id: 'job_opportunities',
        title: 'Job Opportunities',
        icon: 'Star',
        fields: [
          { key: 'job_roles', type: 'TABLE_BUILDER', label: 'Job Roles & Salaries', columns: ['job_profile', 'average_salary'], required: true }
        ]
      },
      {
        id: 'certificate',
        title: 'Certificate',
        icon: 'Award',
        fields: [
          { key: 'certificate_description', type: 'TEXTAREA', label: 'Certificate Description', placeholder: 'Post-completion, enrolled students...', rows: 3 }
        ]
      },
      {
        id: 'reviews_sec',
        title: 'Reviews',
        icon: 'MessageSquare',
        fields: [
          { key: 'reviews', type: 'REVIEW_BUILDER', label: 'Student Reviews', required: true }
        ]
      },
      {
        id: 'faqs_sec',
        title: 'FAQs',
        icon: 'HelpCircle',
        fields: [
          { key: 'faqs', type: 'FAQ_BUILDER', label: 'Frequently Asked Questions', required: true }
        ]
      }
    ]
  },
  
  [PAGE_TYPES.UNIVERSITY]: {
    id: PAGE_TYPES.UNIVERSITY,
    title: 'University Page',
    sections: [
      {
        id: 'uni_basic_info',
        title: 'Basic Info',
        icon: 'Info',
        fields: [
          { key: 'university_name', type: 'TEXT_INPUT', label: 'University Name', placeholder: 'e.g. NMIMS', required: true },
          { key: 'university_full_name', type: 'TEXT_INPUT', label: 'University Full Name', placeholder: 'e.g. Narsee Monjee Institute...' },
          { key: 'location', type: 'TEXT_INPUT', label: 'Location', placeholder: 'e.g. Mumbai, Maharashtra', required: true },
          { key: 'university_type', type: 'TEXT_INPUT', label: 'University Type', placeholder: 'e.g. Deemed-to-be University' },
          { key: 'established_year', type: 'TEXT_INPUT', label: 'Established Year', placeholder: 'e.g. 1981' },
          { 
            key: 'badges', 
            type: 'BADGE_SELECTOR', 
            label: 'Badges', 
            options: ["UGC Approved", "NAAC A++", "NAAC A+", "DEB Approved", "100% Online", "Working Professionals", "AIU Member"] 
          }
        ]
      },
      {
        id: 'uni_hero_details',
        title: 'Hero details',
        icon: 'BarChart3',
        fields: [
          { key: 'hero_title', type: 'TEXT_INPUT', label: 'Hero Title', placeholder: 'e.g. NMIMS Distance Learning Programs', required: true },
          { key: 'hero_description', type: 'TEXTAREA', label: 'Hero Short Description', placeholder: 'A short description of the university', required: true, rows: 3 }
        ]
      },
      {
        id: 'uni_about',
        title: 'About the University',
        icon: 'GraduationCap',
        fields: [
          { key: 'about_content', type: 'RICH_TEXT', label: 'About Content', placeholder: 'Detailed content about the university', required: true },
          { key: 'key_highlights', type: 'LIST_BUILDER', label: 'Key Highlights', placeholder: 'e.g. Ranked Top 10 by NIRF', required: true }
        ]
      },
      {
        id: 'uni_rankings',
        title: 'Rankings & Accreditations',
        icon: 'Award',
        fields: [
          { key: 'rankings_table', type: 'TABLE_BUILDER', label: 'Rankings', columns: ['agency', 'rank', 'year'], required: true }
        ]
      },
      {
        id: 'uni_faqs',
        title: 'FAQs',
        icon: 'HelpCircle',
        fields: [
          { key: 'faqs', type: 'FAQ_BUILDER', label: 'Frequently Asked Questions', required: true }
        ]
      }
    ]
  },

  [PAGE_TYPES.COURSE]: {
    id: PAGE_TYPES.COURSE,
    title: 'Course Page',
    sections: [
      {
        id: 'course_basic_info',
        title: 'Basic Info',
        icon: 'Info',
        fields: [
          { key: 'course_name', type: 'TEXT_INPUT', label: 'Course Name', placeholder: 'e.g. MBA in General Management', required: true },
          { key: 'university_name', type: 'TEXT_INPUT', label: 'University Name', placeholder: 'e.g. NMIMS', required: true },
          { key: 'course_duration', type: 'TEXT_INPUT', label: 'Course Duration', placeholder: 'e.g. 2 Years', required: true },
          { key: 'degree_level', type: 'TEXT_INPUT', label: 'Degree Level (UG/PG)', placeholder: 'e.g. Post Graduate', required: true },
          { 
            key: 'badges', 
            type: 'BADGE_SELECTOR', 
            label: 'Badges', 
            options: ["UGC Approved", "NAAC A++", "NAAC A+", "100% Online", "2 Years", "Working Professionals"] 
          }
        ]
      },
      {
        id: 'course_hero_details',
        title: 'Hero details',
        icon: 'BarChart3',
        fields: [
          { key: 'hero_description', type: 'TEXTAREA', label: 'Hero Short Description', placeholder: 'A short description of the course', required: true, rows: 3 }
        ]
      },
      {
        id: 'course_about',
        title: 'About the Course',
        icon: 'GraduationCap',
        fields: [
          { key: 'about_course', type: 'RICH_TEXT', label: 'About Content', placeholder: 'Detailed content about the course', required: true },
          { key: 'key_benefits', type: 'LIST_BUILDER', label: 'Key Benefits', placeholder: 'e.g. Comprehensive industry aligned syllabus', required: true }
        ]
      },
      {
        id: 'course_eligibility',
        title: 'Eligibility Criteria',
        icon: 'CheckSquare',
        fields: [
          { key: 'eligibility_criteria', type: 'TEXTAREA', label: 'Eligibility Requirements', placeholder: 'e.g. Graduation from a recognized board', required: true, rows: 3 }
        ]
      },
      {
        id: 'course_syllabus',
        title: 'Syllabus',
        icon: 'BookOpen',
        fields: [
          { key: 'subjects_list', type: 'LIST_BUILDER', label: 'Core Subjects List', placeholder: 'e.g. Financial Accounting', required: true }
        ]
      },
      {
        id: 'course_fees',
        title: 'Fees',
        icon: 'CreditCard',
        fields: [
          { key: 'total_fees', type: 'TEXT_INPUT', label: 'Total Fees', placeholder: 'e.g. ₹1.5L', required: true },
          { key: 'semester_fee', type: 'TEXT_INPUT', label: 'Semester Fee', placeholder: 'e.g. ₹35,000' }
        ]
      },
      {
        id: 'course_faqs',
        title: 'FAQs',
        icon: 'HelpCircle',
        fields: [
          { key: 'faqs', type: 'FAQ_BUILDER', label: 'Frequently Asked Questions', required: true }
        ]
      }
    ]
  }
};

export const getIcon = (name) => {
  const icons = { Info, BarChart3, HelpCircle, GraduationCap, Award, CheckSquare, FileText, CreditCard, Landmark, Table, BookOpen, UserCheck, Briefcase, Star, MessageSquare };
  return icons[name] || Info;
};

// Generates the initial form state based on the selected schema
export const getInitialState = (pageType) => {
  const schema = schemas[pageType];
  if (!schema) return {};

  const state = {
    page_type: pageType
  };

  schema.sections.forEach(section => {
    section.fields.forEach(field => {
      if (field.type === 'BADGE_SELECTOR') {
        state[field.key] = [];
      } else if (field.type === 'LIST_BUILDER') {
        state[field.key] = [];
      } else if (field.type === 'TABLE_BUILDER') {
        state[field.key] = [];
      } else if (field.type === 'FAQ_BUILDER') {
        state[field.key] = [];
      } else if (field.type === 'REVIEW_BUILDER') {
        state[field.key] = [];
      } else if (field.type === 'STEP_BUILDER') {
        state[field.key] = [];
      } else {
        state[field.key] = '';
      }
    });
  });

  return state;
};

// Transforms the state into the strict WP ACF JSON payload format
export const transformToACF = (state, pageType) => {
  if (pageType !== PAGE_TYPES.SPECIALIZATION) {
    // Basic mapping for University/Course without strict custom mappings
    const output = { page_type: pageType };
    
    Object.keys(state).forEach(key => {
      if (key === 'page_type') return;
      const val = state[key];
      // Clean table builders to not output empty rows
      if (Array.isArray(val)) {
        if (val.length > 0 && typeof val[0] === 'object' && !Array.isArray(val[0])) {
          // Table or FAQ or Review
          const filtered = val.filter(row => {
            return Object.values(row).some(v => v !== undefined && String(v).trim() !== '');
          });
          output[key] = filtered;
        } else {
          output[key] = val.filter(v => v !== undefined && String(v).trim() !== '');
        }
      } else {
        output[key] = val;
      }
    });
    return output;
  }

  // Strict Specialization transformation
  const output = {
    page_type: PAGE_TYPES.SPECIALIZATION,
    spec_name: state.spec_name || '',
    university_name: state.university_name || '',
    university_full_name: state.university_full_name || '',
    spec_tag_label: state.spec_tag_label || '',
    hero_description: state.hero_description || '',
    badges: state.badges || [],
    
    stat_best_price: state.stat_best_price || '',
    stat_duration: state.stat_duration || '',
    stat_faculty: state.stat_faculty || '',
    stat_hiring_firms: state.stat_hiring_firms || '',
    stat_top_salary: state.stat_top_salary || '',
    
    spec_about: state.spec_about || '',
    fact_duration: state.fact_duration || '',
    fact_validity: state.fact_validity || '',
    fact_faculty_count: state.fact_faculty_count || '',
    pros_list: (state.pros_list || []).filter(item => String(item).trim() !== ''),
    
    course_facts: (state.course_facts || []).filter(item => String(item).trim() !== ''),
    
    eligibility_education: state.eligibility_education || '',
    eligibility_marks: state.eligibility_marks || '',
    admission_fee_note: state.admission_fee_note || '',
    
    fee_semester_amount: state.fee_semester_amount || '',
    fee_semester_total: state.fee_semester_total || '',
    fee_annual_amount: state.fee_annual_amount || '',
    fee_annual_total: state.fee_annual_total || '',
    fee_onetime_amount: state.fee_onetime_amount || '',
    fee_savings_note: state.fee_savings_note || '',
    
    emi_starting_amount: state.emi_starting_amount || '',
    emi_tenures: (state.emi_tenures || []).filter(item => String(item).trim() !== ''),
    emi_highlighted_tenure: state.emi_highlighted_tenure || '',
    emi_partner_banks: (state.emi_partner_banks || []).filter(item => String(item).trim() !== ''),
    scholarship_note: state.scholarship_note || '',
    
    // Table builder: skip empty rows
    specialization_fees: (state.specialization_fees || [])
      .filter(row => row.specialization?.trim() || row.fee_per_semester?.trim())
      .map(row => ({
        specialization: row.specialization || '',
        fee_per_semester: row.fee_per_semester || ''
      })),
      
    // Nested syllabus transformation
    syllabus: {
      "Year I": {
        "Semester I": (state.syllabus_y1_s1 || []).filter(item => String(item).trim() !== ''),
        "Semester II": (state.syllabus_y1_s2 || []).filter(item => String(item).trim() !== '')
      },
      "Year II": {
        "Semester III": (state.syllabus_y2_s3 || []).filter(item => String(item).trim() !== ''),
        "Semester IV": (state.syllabus_y2_s4 || []).filter(item => String(item).trim() !== '')
      }
    },
    
    exam_pattern: state.exam_pattern || '',
    
    // Step builder output: convert to HTML ordered list
    admission_process: (() => {
      const steps = (state.admission_process || []).filter(step => String(step).trim() !== '');
      if (steps.length === 0) return '';
      return `<ol>${steps.map(step => `<li>${step}</li>`).join('')}</ol>`;
    })(),
    
    // Combined placements stats array
    placement_stats: [
      { value: state.placement_stat_1_value || '', label: state.placement_stat_1_label || '' },
      { value: state.placement_stat_2_value || '', label: state.placement_stat_2_label || '' },
      { value: state.placement_stat_3_value || '', label: state.placement_stat_3_label || '' }
    ].filter(stat => stat.value.trim() || stat.label.trim()),
    
    placement_partners: (state.placement_partners || []).filter(item => String(item).trim() !== ''),
    
    // Table builder: skip empty rows
    job_roles: (state.job_roles || [])
      .filter(row => row.job_profile?.trim() || row.average_salary?.trim())
      .map(row => ({
        job_profile: row.job_profile || '',
        average_salary: row.average_salary || ''
      })),
      
    reviews: (state.reviews || [])
      .filter(r => r.review?.trim() || r.author?.trim())
      .map(r => ({
        review: r.review || '',
        author: r.author || ''
      })),
      
    faqs: (state.faqs || [])
      .filter(f => f.question?.trim() || f.answer?.trim())
      .map(f => ({
        question: f.question || '',
        answer: f.answer || ''
      }))
  };
  
  return output;
};

// Validates the state and returns an object: { isValid: boolean, errors: string[], invalidFields: Record<string, boolean> }
export const validateState = (state, pageType) => {
  const errors = [];
  const invalidFields = {};

  const markInvalid = (fieldKey) => {
    invalidFields[fieldKey] = true;
  };

  if (pageType !== PAGE_TYPES.SPECIALIZATION) {
    // Simple validation for course and university
    const schema = schemas[pageType];
    schema.sections.forEach(sec => {
      sec.fields.forEach(f => {
        if (f.required) {
          const val = state[f.key];
          if (!val || (Array.isArray(val) && val.length === 0)) {
            errors.push(`"${f.label}" is required.`);
            markInvalid(f.key);
          }
        }
      });
    });
    return {
      isValid: errors.length === 0,
      errors,
      invalidFields
    };
  }

  // Strict validation rules for Specialization page
  
  // spec_name
  if (!state.spec_name || state.spec_name.trim() === '') {
    errors.push('Specialization Name is required (Section 1).');
    markInvalid('spec_name');
  }

  // university_name
  if (!state.university_name || state.university_name.trim() === '') {
    errors.push('University Name is required (Section 1).');
    markInvalid('university_name');
  }

  // hero_description
  if (!state.hero_description || state.hero_description.trim() === '') {
    errors.push('Hero Short Description is required (Section 1).');
    markInvalid('hero_description');
  }

  // spec_about
  if (!state.spec_about || state.spec_about.trim() === '' || state.spec_about === '<p></p>') {
    errors.push('About Content (Rich Text) is required (Section 3).');
    markInvalid('spec_about');
  }

  // pros_list (min 2 items)
  const pros = (state.pros_list || []).filter(item => String(item).trim() !== '');
  if (pros.length < 2) {
    errors.push(`Key Advantages requires at least 2 items, found ${pros.length} (Section 3).`);
    markInvalid('pros_list');
  }

  // course_facts (min 2 items)
  const facts = (state.course_facts || []).filter(item => String(item).trim() !== '');
  if (facts.length < 2) {
    errors.push(`Program Highlight Points requires at least 2 items, found ${facts.length} (Section 4).`);
    markInvalid('course_facts');
  }

  // eligibility_education
  if (!state.eligibility_education || state.eligibility_education.trim() === '') {
    errors.push('Education Qualification is required (Section 5).');
    markInvalid('eligibility_education');
  }

  // fee_onetime_amount
  if (!state.fee_onetime_amount || state.fee_onetime_amount.trim() === '') {
    errors.push('One-Time Payment Amount (Best Value) is required (Section 6).');
    markInvalid('fee_onetime_amount');
  }

  // emi_starting_amount
  if (!state.emi_starting_amount || state.emi_starting_amount.trim() === '') {
    errors.push('EMI Starting From is required (Section 7).');
    markInvalid('emi_starting_amount');
  }

  // specialization_fees (min 2 rows)
  const specFees = (state.specialization_fees || []).filter(row => row.specialization?.trim() || row.fee_per_semester?.trim());
  if (specFees.length < 2) {
    errors.push(`Other Specializations & Fees Table requires at least 2 valid rows, found ${specFees.length} (Section 8).`);
    markInvalid('specialization_fees');
  }

  // syllabus (all 4 semesters have at least 3 subjects)
  const y1s1 = (state.syllabus_y1_s1 || []).filter(item => String(item).trim() !== '');
  const y1s2 = (state.syllabus_y1_s2 || []).filter(item => String(item).trim() !== '');
  const y2s3 = (state.syllabus_y2_s3 || []).filter(item => String(item).trim() !== '');
  const y2s4 = (state.syllabus_y2_s4 || []).filter(item => String(item).trim() !== '');

  if (y1s1.length < 3) {
    errors.push(`Year 1 — Semester 1 requires at least 3 subjects, found ${y1s1.length} (Section 9).`);
    markInvalid('syllabus_y1_s1');
  }
  if (y1s2.length < 3) {
    errors.push(`Year 1 — Semester 2 requires at least 3 subjects, found ${y1s2.length} (Section 9).`);
    markInvalid('syllabus_y1_s2');
  }
  if (y2s3.length < 3) {
    errors.push(`Year 2 — Semester 3 requires at least 3 subjects, found ${y2s3.length} (Section 9).`);
    markInvalid('syllabus_y2_s3');
  }
  if (y2s4.length < 3) {
    errors.push(`Year 2 — Semester 4 requires at least 3 subjects, found ${y2s4.length} (Section 9).`);
    markInvalid('syllabus_y2_s4');
  }

  // admission_process (min 3 steps)
  const steps = (state.admission_process || []).filter(item => String(item).trim() !== '');
  if (steps.length < 3) {
    errors.push(`Admission Steps requires at least 3 steps, found ${steps.length} (Section 11).`);
    markInvalid('admission_process');
  }

  // placement_partners (min 3 items)
  const partners = (state.placement_partners || []).filter(item => String(item).trim() !== '');
  if (partners.length < 3) {
    errors.push(`Top Hiring Partners requires at least 3 items, found ${partners.length} (Section 12).`);
    markInvalid('placement_partners');
  }

  // job_roles (min 3 rows)
  const jobRoles = (state.job_roles || []).filter(row => row.job_profile?.trim() || row.average_salary?.trim());
  if (jobRoles.length < 3) {
    errors.push(`Job Roles & Salaries Table requires at least 3 valid rows, found ${jobRoles.length} (Section 13).`);
    markInvalid('job_roles');
  }

  // reviews (min 2 reviews)
  const reviews = (state.reviews || []).filter(r => r.review?.trim() || r.author?.trim());
  if (reviews.length < 2) {
    errors.push(`Student Reviews requires at least 2 reviews, found ${reviews.length} (Section 15).`);
    markInvalid('reviews');
  }

  // faqs (min 3 FAQs)
  const faqs = (state.faqs || []).filter(f => f.question?.trim() || f.answer?.trim());
  if (faqs.length < 3) {
    errors.push(`FAQs requires at least 3 questions, found ${faqs.length} (Section 16).`);
    markInvalid('faqs');
  }

  return {
    isValid: errors.length === 0,
    errors,
    invalidFields
  };
};

// Computes the completion percentage of required fields
export const calculateProgress = (state, pageType) => {
  if (pageType !== PAGE_TYPES.SPECIALIZATION) {
    const schema = schemas[pageType];
    if (!schema) return 0;
    let requiredCount = 0;
    let filledRequiredCount = 0;

    schema.sections.forEach(sec => {
      sec.fields.forEach(f => {
        if (f.required) {
          requiredCount++;
          const val = state[f.key];
          if (Array.isArray(val)) {
            if (val.length > 0) filledRequiredCount++;
          } else if (val && String(val).trim() !== '') {
            filledRequiredCount++;
          }
        }
      });
    });

    if (requiredCount === 0) return 100;
    return Math.round((filledRequiredCount / requiredCount) * 100);
  }

  // Specialization custom progress calculation
  // List of required rules:
  // 1. spec_name: text filled
  // 2. university_name: text filled
  // 3. hero_description: text filled
  // 4. spec_about: rich text filled
  // 5. pros_list: >= 2 items
  // 6. course_facts: >= 2 items
  // 7. eligibility_education: text filled
  // 8. fee_onetime_amount: text filled
  // 9. emi_starting_amount: text filled
  // 10. specialization_fees: >= 2 rows
  // 11-14. syllabus: y1s1 >= 3, y1s2 >= 3, y2s3 >= 3, y2s4 >= 3
  // 15. admission_process: >= 3 steps
  // 16. placement_partners: >= 3 items
  // 17. job_roles: >= 3 rows
  // 18. reviews: >= 2 reviews
  // 19. faqs: >= 3 faqs

  const checks = [
    { key: 'spec_name', check: () => !!state.spec_name && state.spec_name.trim() !== '' },
    { key: 'university_name', check: () => !!state.university_name && state.university_name.trim() !== '' },
    { key: 'hero_description', check: () => !!state.hero_description && state.hero_description.trim() !== '' },
    { key: 'spec_about', check: () => !!state.spec_about && state.spec_about.trim() !== '' && state.spec_about !== '<p></p>' },
    { key: 'pros_list', check: () => (state.pros_list || []).filter(i => String(i).trim() !== '').length >= 2 },
    { key: 'course_facts', check: () => (state.course_facts || []).filter(i => String(i).trim() !== '').length >= 2 },
    { key: 'eligibility_education', check: () => !!state.eligibility_education && state.eligibility_education.trim() !== '' },
    { key: 'fee_onetime_amount', check: () => !!state.fee_onetime_amount && state.fee_onetime_amount.trim() !== '' },
    { key: 'emi_starting_amount', check: () => !!state.emi_starting_amount && state.emi_starting_amount.trim() !== '' },
    { key: 'specialization_fees', check: () => (state.specialization_fees || []).filter(r => r.specialization?.trim() || r.fee_per_semester?.trim()).length >= 2 },
    { key: 'syllabus_y1_s1', check: () => (state.syllabus_y1_s1 || []).filter(i => String(i).trim() !== '').length >= 3 },
    { key: 'syllabus_y1_s2', check: () => (state.syllabus_y1_s2 || []).filter(i => String(i).trim() !== '').length >= 3 },
    { key: 'syllabus_y2_s3', check: () => (state.syllabus_y2_s3 || []).filter(i => String(i).trim() !== '').length >= 3 },
    { key: 'syllabus_y2_s4', check: () => (state.syllabus_y2_s4 || []).filter(i => String(i).trim() !== '').length >= 3 },
    { key: 'admission_process', check: () => (state.admission_process || []).filter(i => String(i).trim() !== '').length >= 3 },
    { key: 'placement_partners', check: () => (state.placement_partners || []).filter(i => String(i).trim() !== '').length >= 3 },
    { key: 'job_roles', check: () => (state.job_roles || []).filter(r => r.job_profile?.trim() || r.average_salary?.trim()).length >= 3 },
    { key: 'reviews', check: () => (state.reviews || []).filter(r => r.review?.trim() || r.author?.trim()).length >= 2 },
    { key: 'faqs', check: () => (state.faqs || []).filter(f => f.question?.trim() || f.answer?.trim()).length >= 3 }
  ];

  const total = checks.length;
  const passed = checks.filter(c => c.check()).length;

  return Math.round((passed / total) * 100);
};

// Gets the completion state of a section: 'empty' | 'partial' | 'complete'
export const getSectionStatus = (state, section, pageType) => {
  let hasAnyFilled = false;
  let hasAllRequiredFilled = true;
  let requiredCount = 0;

  if (pageType === PAGE_TYPES.SPECIALIZATION) {
    // Custom check per section to match exact rules
    const fieldKeys = section.fields.map(f => f.key);
    
    // We check individual fields in this section
    section.fields.forEach(f => {
      const val = state[f.key];
      let isFieldFilled = false;

      if (Array.isArray(val)) {
        isFieldFilled = val.filter(i => {
          if (typeof i === 'object') {
            return Object.values(i).some(v => v && String(v).trim() !== '');
          }
          return String(i).trim() !== '';
        }).length > 0;
      } else {
        isFieldFilled = val && String(val).trim() !== '' && val !== '<p></p>';
      }

      if (isFieldFilled) {
        hasAnyFilled = true;
      }

      // Check if it's required and meets rule
      if (f.required) {
        requiredCount++;
        let meetsRule = false;
        
        if (f.key === 'pros_list') {
          meetsRule = (state.pros_list || []).filter(i => String(i).trim() !== '').length >= 2;
        } else if (f.key === 'course_facts') {
          meetsRule = (state.course_facts || []).filter(i => String(i).trim() !== '').length >= 2;
        } else if (f.key === 'specialization_fees') {
          meetsRule = (state.specialization_fees || []).filter(r => r.specialization?.trim() || r.fee_per_semester?.trim()).length >= 2;
        } else if (f.key === 'syllabus_y1_s1' || f.key === 'syllabus_y1_s2' || f.key === 'syllabus_y2_s3' || f.key === 'syllabus_y2_s4') {
          meetsRule = (state[f.key] || []).filter(i => String(i).trim() !== '').length >= 3;
        } else if (f.key === 'admission_process') {
          meetsRule = (state.admission_process || []).filter(i => String(i).trim() !== '').length >= 3;
        } else if (f.key === 'placement_partners') {
          meetsRule = (state.placement_partners || []).filter(i => String(i).trim() !== '').length >= 3;
        } else if (f.key === 'job_roles') {
          meetsRule = (state.job_roles || []).filter(r => r.job_profile?.trim() || r.average_salary?.trim()).length >= 3;
        } else if (f.key === 'reviews') {
          meetsRule = (state.reviews || []).filter(r => r.review?.trim() || r.author?.trim()).length >= 2;
        } else if (f.key === 'faqs') {
          meetsRule = (state.faqs || []).filter(f => f.question?.trim() || f.answer?.trim()).length >= 3;
        } else {
          meetsRule = isFieldFilled;
        }

        if (!meetsRule) {
          hasAllRequiredFilled = false;
        }
      }
    });

    if (requiredCount === 0) {
      // If no required fields, and any is filled, it is complete. If none is filled, it is empty.
      return hasAnyFilled ? 'complete' : 'empty';
    }

    if (!hasAnyFilled) return 'empty';
    return hasAllRequiredFilled ? 'complete' : 'partial';
  }

  // Standard calculation for other page types
  section.fields.forEach(f => {
    const val = state[f.key];
    const isFilled = Array.isArray(val) ? val.length > 0 : (val && String(val).trim() !== '');
    if (isFilled) hasAnyFilled = true;
    if (f.required) {
      requiredCount++;
      if (!isFilled) hasAllRequiredFilled = false;
    }
  });

  if (requiredCount === 0) {
    return hasAnyFilled ? 'complete' : 'empty';
  }
  if (!hasAnyFilled) return 'empty';
  return hasAllRequiredFilled ? 'complete' : 'partial';
};
