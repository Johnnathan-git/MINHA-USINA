export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      budgets: {
        Row: {
          amount_projected: number
          category_id: string
          created_at: string | null
          id: string
          month: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          amount_projected?: number
          category_id: string
          created_at?: string | null
          id?: string
          month: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          amount_projected?: number
          category_id?: string
          created_at?: string | null
          id?: string
          month?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "transaction_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      category_suggestions: {
        Row: {
          category_id: string
          frequency: number | null
          id: string
          search_term: string
          user_id: string
        }
        Insert: {
          category_id: string
          frequency?: number | null
          id?: string
          search_term: string
          user_id: string
        }
        Update: {
          category_id?: string
          frequency?: number | null
          id?: string
          search_term?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_suggestions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "transaction_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      client_allocations: {
        Row: {
          allocation_pct: number
          avg_consumption: number
          client_id: string
          updated_at: string
        }
        Insert: {
          allocation_pct?: number
          avg_consumption?: number
          client_id: string
          updated_at?: string
        }
        Update: {
          allocation_pct?: number
          avg_consumption?: number
          client_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_allocations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          active: boolean
          color: string
          created_at: string
          discount_pct: number | null
          email: string | null
          first_name: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          public_lighting_value: number | null
          uc_number: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          color?: string
          created_at?: string
          discount_pct?: number | null
          email?: string | null
          first_name?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          public_lighting_value?: number | null
          uc_number: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          color?: string
          created_at?: string
          discount_pct?: number | null
          email?: string | null
          first_name?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          public_lighting_value?: number | null
          uc_number?: string
          updated_at?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          description: string
          id: string
          installment_group: string | null
          installment_no: number | null
          installment_total: number | null
          notes: string | null
          reference_date: string
          updated_at: string
        }
        Insert: {
          amount?: number
          category: string
          created_at?: string
          description: string
          id?: string
          installment_group?: string | null
          installment_no?: number | null
          installment_total?: number | null
          notes?: string | null
          reference_date: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          description?: string
          id?: string
          installment_group?: string | null
          installment_no?: number | null
          installment_total?: number | null
          notes?: string | null
          reference_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      inventory_assets: {
        Row: {
          acquired_on: string | null
          brand: string | null
          category: string
          created_at: string
          id: string
          item: string
          location: string | null
          model: string | null
          notes: string | null
          quantity: number
          serial_number: string | null
          unit_value: number
          updated_at: string
        }
        Insert: {
          acquired_on?: string | null
          brand?: string | null
          category?: string
          created_at?: string
          id?: string
          item: string
          location?: string | null
          model?: string | null
          notes?: string | null
          quantity?: number
          serial_number?: string | null
          unit_value?: number
          updated_at?: string
        }
        Update: {
          acquired_on?: string | null
          brand?: string | null
          category?: string
          created_at?: string
          id?: string
          item?: string
          location?: string | null
          model?: string | null
          notes?: string | null
          quantity?: number
          serial_number?: string | null
          unit_value?: number
          updated_at?: string
        }
        Relationships: []
      }
      investment_expenses: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          notes: string | null
          responsible: string | null
          spent_on: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          description: string
          id?: string
          notes?: string | null
          responsible?: string | null
          spent_on: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          notes?: string | null
          responsible?: string | null
          spent_on?: string
          updated_at?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          attachment_url: string | null
          client_id: string
          client_pays: number
          consumption_kw: number
          created_at: string
          distributor_invoice: number
          id: string
          interest_fine: number
          notes: string | null
          price_kw: number
          public_lighting: number
          reference_date: string
          uc_number: string
          updated_at: string
          value_without_plant: number
        }
        Insert: {
          attachment_url?: string | null
          client_id: string
          client_pays?: number
          consumption_kw?: number
          created_at?: string
          distributor_invoice?: number
          id?: string
          interest_fine?: number
          notes?: string | null
          price_kw?: number
          public_lighting?: number
          reference_date: string
          uc_number: string
          updated_at?: string
          value_without_plant?: number
        }
        Update: {
          attachment_url?: string | null
          client_id?: string
          client_pays?: number
          consumption_kw?: number
          created_at?: string
          distributor_invoice?: number
          id?: string
          interest_fine?: number
          notes?: string | null
          price_kw?: number
          public_lighting?: number
          reference_date?: string
          uc_number?: string
          updated_at?: string
          value_without_plant?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_invoice_imports: {
        Row: {
          attachment_url: string | null
          client_id: string
          consumption_kw: number
          created_at: string
          distributor_invoice: number
          due_date: string | null
          id: string
          interest_fine: number
          price_kw: number
          price_kw_exact: string | null
          public_lighting: number
          reference_date: string
          source_gmail_message_id: string | null
          source_pdf_filename: string | null
          status: string
          uc_number: string
          updated_at: string
        }
        Insert: {
          attachment_url?: string | null
          client_id: string
          consumption_kw?: number
          created_at?: string
          distributor_invoice?: number
          due_date?: string | null
          id?: string
          interest_fine?: number
          price_kw?: number
          price_kw_exact?: string | null
          public_lighting?: number
          reference_date: string
          source_gmail_message_id?: string | null
          source_pdf_filename?: string | null
          status?: string
          uc_number: string
          updated_at?: string
        }
        Update: {
          attachment_url?: string | null
          client_id?: string
          consumption_kw?: number
          created_at?: string
          distributor_invoice?: number
          due_date?: string | null
          id?: string
          interest_fine?: number
          price_kw?: number
          price_kw_exact?: string | null
          public_lighting?: number
          reference_date?: string
          source_gmail_message_id?: string | null
          source_pdf_filename?: string | null
          status?: string
          uc_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_invoice_imports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_queue: {
        Row: {
          client_id: string
          client_name: string
          created_at: string
          error: string | null
          id: string
          message_text: string
          phone: string
          reference_month: string
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          client_id: string
          client_name: string
          created_at?: string
          error?: string | null
          id?: string
          message_text: string
          phone: string
          reference_month: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          client_name?: string
          created_at?: string
          error?: string | null
          id?: string
          message_text?: string
          phone?: string
          reference_month?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_queue_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      plant_config: {
        Row: {
          id: number
          kw_per_panel: number
          panels_count: number
          updated_at: string
        }
        Insert: {
          id?: number
          kw_per_panel?: number
          panels_count?: number
          updated_at?: string
        }
        Update: {
          id?: number
          kw_per_panel?: number
          panels_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      transaction_categories: {
        Row: {
          color: string | null
          created_at: string | null
          icon: string | null
          id: string
          name: string
          type: string
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          icon?: string | null
          id?: string
          name: string
          type: string
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          icon?: string | null
          id?: string
          name?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          attachment_url: string | null
          category_id: string | null
          created_at: string | null
          date: string
          description: string | null
          id: string
          installment_group: string | null
          installment_no: number | null
          installment_total: number | null
          status: string
          type: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          amount: number
          attachment_url?: string | null
          category_id?: string | null
          created_at?: string | null
          date: string
          description?: string | null
          id?: string
          installment_group?: string | null
          installment_no?: number | null
          installment_total?: number | null
          status?: string
          type: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          attachment_url?: string | null
          category_id?: string | null
          created_at?: string | null
          date?: string
          description?: string | null
          id?: string
          installment_group?: string | null
          installment_no?: number | null
          installment_total?: number | null
          status?: string
          type?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "transaction_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      user_clients: {
        Row: {
          client_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_clients_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permissions: {
        Row: {
          created_at: string
          id: string
          module: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          module: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          module?: string
          user_id?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          display_name: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          display_name: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          display_name?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
